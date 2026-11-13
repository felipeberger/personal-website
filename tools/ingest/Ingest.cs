// Ingest: reads every chunk file (*.json) in a data folder, validates it, embeds
// "title + text" with an Azure OpenAI embedding deployment, and writes one index.json
// that the API loads at startup.
//
// Re-runs are incremental: a chunk is only re-embedded when its title/text (or the
// embedding deployment) changed. Tags, related ids, org and period are not embedded,
// so editing them is free.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Azure;
using Azure.AI.OpenAI;
using Azure.Identity;
using Microsoft.Extensions.AI;

internal static class Program
{
    private const int BatchSize = 16;

    // Input files use lowercase keys; match case-insensitively.
    private static readonly JsonSerializerOptions JsonIn = new() { PropertyNameCaseInsensitive = true };

    // The index is written with camelCase keys and no indentation (vectors are large).
    private static readonly JsonSerializerOptions JsonOut = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public static async Task<int> Main(string[] args)
    {
        var opts = Options.Parse(args);
        if (opts.Help)
        {
            Console.WriteLine(Options.HelpText);
            return 0;
        }

        if (!Directory.Exists(opts.DataDir))
        {
            Console.Error.WriteLine($"Data directory not found: {opts.DataDir}");
            return 1;
        }

        // 1. Load and validate (no network needed).
        var errors = new List<string>();
        var warnings = new List<string>();
        var chunks = LoadChunks(opts, errors);
        Validate(chunks, errors, warnings);

        foreach (var w in warnings) Console.WriteLine($"warning: {w}");
        if (errors.Count > 0)
        {
            foreach (var e in errors) Console.Error.WriteLine($"error: {e}");
            return 1;
        }
        if (chunks.Count == 0)
        {
            Console.Error.WriteLine("No chunks found.");
            return 1;
        }

        Console.WriteLine($"Loaded {chunks.Count} chunks from {chunks.Select(c => c.File).Distinct().Count()} files:");
        foreach (var g in chunks.GroupBy(c => c.Source))
            Console.WriteLine($"  {g.Key}: {g.Count()}");

        if (opts.DryRun)
        {
            Console.WriteLine("Dry run: validation passed, nothing embedded.");
            return 0;
        }

        // 2. Configuration.
        if (!Uri.TryCreate(opts.Endpoint, UriKind.Absolute, out var endpoint) ||
            string.IsNullOrWhiteSpace(opts.Deployment))
        {
            Console.Error.WriteLine(
                "Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_EMBEDDING_DEPLOYMENT " +
                "(or pass --endpoint and --deployment).");
            return 1;
        }
        var deployment = opts.Deployment!;

        // 3. Work out what actually needs embedding.
        var existing = opts.Force ? new Dictionary<string, IndexedChunk>() : LoadExisting(opts.OutPath);
        var indexed = new Dictionary<string, IndexedChunk>();
        var pending = new List<(Chunk Chunk, string Input, string Hash)>();

        foreach (var c in chunks)
        {
            var input = EmbedInput(c);
            var hash = ComputeHash(opts.Endpoint!, deployment, input);

            if (existing.TryGetValue(c.Id, out var old) && old.Hash == hash && old.Vector is { Length: > 0 })
                indexed[c.Id] = Build(c, hash, old.Vector); // reuse vector, refresh metadata
            else
                pending.Add((c, input, hash));
        }

        Console.WriteLine($"{indexed.Count} unchanged (reused), {pending.Count} to embed.");

        // 4. Embed in batches.
        try
        {
            if (pending.Count > 0)
            {
                var client = new AzureOpenAIClient(endpoint, new DefaultAzureCredential());
                IEmbeddingGenerator<string, Embedding<float>> embedder =
                    client.GetEmbeddingClient(deployment).AsIEmbeddingGenerator();

                for (var i = 0; i < pending.Count; i += BatchSize)
                {
                    var batch = pending.Skip(i).Take(BatchSize).ToList();
                    var inputs = batch.Select(b => b.Input).ToList();

                    var embeddings = await embedder.GenerateAsync(inputs);
                    if (embeddings.Count != batch.Count)
                        throw new InvalidOperationException(
                            $"Expected {batch.Count} embeddings but received {embeddings.Count}.");

                    for (var j = 0; j < batch.Count; j++)
                    {
                        var (chunk, _, hash) = batch[j];
                        indexed[chunk.Id] = Build(chunk, hash, embeddings[j].Vector.ToArray());
                    }

                    Console.WriteLine($"  embedded {Math.Min(i + BatchSize, pending.Count)}/{pending.Count}");
                }
            }
        }
        catch (AuthenticationFailedException ex)
        {
            Console.Error.WriteLine($"Azure sign-in failed: {ex.Message}");
            Console.Error.WriteLine("Run `az login`, and make sure your account has the " +
                                    "'Cognitive Services OpenAI User' role on the Azure OpenAI resource.");
            return 2;
        }
        catch (RequestFailedException ex)
        {
            Console.Error.WriteLine($"Azure OpenAI request failed ({ex.Status}): {ex.Message}");
            Console.Error.WriteLine("Check the endpoint, the deployment name, and your role assignment.");
            return 2;
        }

        // 5. Assemble in source order and sanity-check dimensions.
        var final = chunks.Select(c => indexed[c.Id]).ToList();
        var dimensions = final.Select(c => c.Vector.Length).Distinct().ToList();
        if (dimensions.Count != 1)
        {
            Console.Error.WriteLine(
                $"Vectors have inconsistent sizes ({string.Join(", ", dimensions)}). " +
                "Re-run with --force to re-embed everything.");
            return 1;
        }

        var removed = existing.Keys.Except(chunks.Select(c => c.Id)).Count();

        // 6. Write atomically.
        var index = new IndexFile(deployment, dimensions[0], DateTime.UtcNow, final);
        var fullOut = Path.GetFullPath(opts.OutPath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullOut)!);
        var tmp = fullOut + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(index, JsonOut));
        File.Move(tmp, fullOut, overwrite: true);

        var sizeKb = new FileInfo(fullOut).Length / 1024.0;
        Console.WriteLine(
            $"Wrote {final.Count} chunks ({dimensions[0]} dimensions, {sizeKb:F0} KB) to {fullOut}");
        if (removed > 0) Console.WriteLine($"Removed {removed} chunk(s) no longer present in the source files.");
        return 0;
    }

    // ---------- Loading and validation ----------

    private static List<Chunk> LoadChunks(Options opts, List<string> errors)
    {
        var chunks = new List<Chunk>();
        var outFull = Path.GetFullPath(opts.OutPath);

        var files = Directory.GetFiles(opts.DataDir, "*.json")
            .Where(f => !string.Equals(Path.GetFullPath(f), outFull, StringComparison.OrdinalIgnoreCase))
            .Where(f => !string.Equals(Path.GetFileName(f), "index.json", StringComparison.OrdinalIgnoreCase))
            .OrderBy(f => f, StringComparer.OrdinalIgnoreCase);

        foreach (var file in files)
        {
            var name = Path.GetFileName(file);
            try
            {
                var items = JsonSerializer.Deserialize<List<RawChunk>>(File.ReadAllText(file), JsonIn)
                            ?? new List<RawChunk>();

                foreach (var r in items)
                {
                    chunks.Add(new Chunk(
                        Id: r.Id ?? "",
                        Type: r.Type ?? "",
                        Title: r.Title ?? "",
                        Text: r.Text ?? "",
                        Org: r.Org,
                        Period: r.Period,
                        Source: r.Source ?? Path.GetFileNameWithoutExtension(file),
                        Tags: r.Tags ?? Array.Empty<string>(),
                        Related: r.Related ?? Array.Empty<string>(),
                        File: name));
                }
            }
            catch (JsonException ex)
            {
                errors.Add($"{name}: invalid JSON ({ex.Message})");
            }
        }

        return chunks;
    }

    private static void Validate(List<Chunk> chunks, List<string> errors, List<string> warnings)
    {
        var seen = new Dictionary<string, string>();

        foreach (var c in chunks)
        {
            if (string.IsNullOrWhiteSpace(c.Id))
            {
                errors.Add($"{c.File}: chunk with an empty id (title: '{c.Title}')");
                continue;
            }

            if (!seen.TryAdd(c.Id, c.File))
                errors.Add($"Duplicate id '{c.Id}' in {c.File} (first seen in {seen[c.Id]})");
            if (string.IsNullOrWhiteSpace(c.Title)) errors.Add($"{c.Id}: empty title");
            if (string.IsNullOrWhiteSpace(c.Text)) errors.Add($"{c.Id}: empty text");

            var words = c.Text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;
            if (words > 0 && words < 15)
                warnings.Add($"{c.Id}: only {words} words; very short chunks retrieve poorly");
            if (words > 200)
                warnings.Add($"{c.Id}: {words} words; consider splitting this chunk");
        }

        var ids = seen.Keys.ToHashSet();
        foreach (var c in chunks)
            foreach (var r in c.Related)
                if (!ids.Contains(r))
                    warnings.Add($"{c.Id}: related id '{r}' does not exist");
    }

    private static Dictionary<string, IndexedChunk> LoadExisting(string path)
    {
        if (!File.Exists(path)) return new Dictionary<string, IndexedChunk>();

        try
        {
            var index = JsonSerializer.Deserialize<IndexFile>(File.ReadAllText(path), JsonIn);
            return index?.Chunks?.ToDictionary(c => c.Id) ?? new Dictionary<string, IndexedChunk>();
        }
        catch (Exception ex) when (ex is JsonException or IOException or ArgumentException)
        {
            Console.WriteLine($"warning: could not read the existing index ({ex.Message}); re-embedding everything.");
            return new Dictionary<string, IndexedChunk>();
        }
    }

    // ---------- Helpers ----------

    // Title is included because it gives the embedding useful context ("Story: ...", "Project: ...").
    private static string EmbedInput(Chunk c) => $"{c.Title}\n{c.Text}";

    // Hash includes the endpoint and deployment so switching resources or models forces a full re-embed.
    private static string ComputeHash(string endpoint, string deployment, string input) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{endpoint}\n{deployment}\n{input}")));

    private static IndexedChunk Build(Chunk c, string hash, float[] vector) =>
        new(c.Id, c.Type, c.Title, c.Text, c.Org, c.Period, c.Source, c.Tags, c.Related, c.File, hash, vector);
}

// ---------- Models ----------

// Shape of the source JSON files (all fields optional so validation can report problems clearly).
internal sealed record RawChunk(
    string? Id, string? Type, string? Title, string? Text, string? Org, string? Period,
    string? Source, string[]? Tags, string[]? Related);

internal sealed record Chunk(
    string Id, string Type, string Title, string Text, string? Org, string? Period,
    string Source, string[] Tags, string[] Related, string File);

// One entry in index.json: the chunk plus its content hash and embedding vector.
internal sealed record IndexedChunk(
    string Id, string Type, string Title, string Text, string? Org, string? Period,
    string Source, string[] Tags, string[] Related, string File, string Hash, float[] Vector);

// index.json. The API must embed questions with the same deployment recorded here.
internal sealed record IndexFile(
    string EmbeddingDeployment, int Dimensions, DateTime CreatedUtc, List<IndexedChunk> Chunks);

internal sealed record Options(
    string DataDir, string OutPath, string? Endpoint, string? Deployment,
    bool DryRun, bool Force, bool Help)
{
    public static Options Parse(string[] args)
    {
        string? Get(string name)
        {
            var i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }

        bool Has(string name) => Array.IndexOf(args, name) >= 0;

        var dataDir = Get("--data") ?? "data";
        return new Options(
            DataDir: dataDir,
            OutPath: Get("--out") ?? Path.Combine(dataDir, "index.json"),
            Endpoint: Get("--endpoint") ?? Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT"),
            Deployment: Get("--deployment") ?? Environment.GetEnvironmentVariable("AZURE_OPENAI_EMBEDDING_DEPLOYMENT"),
            DryRun: Has("--dry-run"),
            Force: Has("--force"),
            Help: Has("--help") || Has("-h"));
    }

    public const string HelpText = """
        Usage: dotnet run -- [options]

          --data <dir>          Folder containing the chunk *.json files (default: data)
          --out <file>          Index file to write (default: <data>/index.json)
          --endpoint <url>      Azure OpenAI endpoint (or env AZURE_OPENAI_ENDPOINT)
          --deployment <name>   Embedding deployment name (or env AZURE_OPENAI_EMBEDDING_DEPLOYMENT)
          --dry-run             Validate the chunk files only; no Azure calls
          --force               Re-embed every chunk, ignoring the existing index
          -h, --help            Show this help

        Authentication uses DefaultAzureCredential (az login locally, managed identity in Azure).
        """;
}