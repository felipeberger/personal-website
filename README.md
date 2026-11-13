# Ingest

Reads the chunk files in `data/`, embeds each chunk with Azure OpenAI, and writes `data/index.json`.

## Suggested layout

```
repo/
  data/
    cv-chunks.json
    story-chunks.json
    project-chunks.json
    consulting-cv.json
  tools/Ingest/        <- this folder
  api/
```

Every `*.json` file in `data/` (except `index.json`) is treated as a chunk file.

## One-time setup

```bash
cd tools/Ingest
dotnet add package Azure.AI.OpenAI
dotnet add package Azure.Identity
dotnet add package Microsoft.Extensions.AI.OpenAI
# If NuGet reports only prerelease versions for a package, add --prerelease
```

Sign in and set the config (PowerShell shown; use `export` on Linux/macOS):

```powershell
az login
$env:AZURE_OPENAI_ENDPOINT = "https://<your-resource>.openai.azure.com/"
$env:AZURE_OPENAI_EMBEDDING_DEPLOYMENT = "<your-embedding-deployment-name>"
```

Your account needs the **Cognitive Services OpenAI User** role on the Azure OpenAI resource.

## Run

```bash
# From the repo root
dotnet run --project tools/Ingest -- --dry-run     # validate only, no Azure calls
dotnet run --project tools/Ingest                  # embed and write data/index.json
dotnet run --project tools/Ingest -- --force       # re-embed everything
```

Options: `--data <dir>`, `--out <file>`, `--endpoint <url>`, `--deployment <name>`, `--dry-run`, `--force`.

## What it does

1. Loads and validates all chunk files: duplicate or empty ids, empty text, bad JSON (errors); very short or long chunks and `related` ids that don't exist (warnings).
2. Embeds `title + "\n" + text` for each chunk in batches of 16.
3. Skips chunks whose title, text, and embedding deployment are unchanged since the last run (vectors are reused). Editing `tags`, `related`, `org`, or `period` does not trigger re-embedding.
4. Drops chunks that no longer exist in the source files.
5. Writes `index.json` atomically.

## index.json format

```json
{
  "embeddingDeployment": "text-embedding-3-small",
  "dimensions": 1536,
  "createdUtc": "2026-11-12T00:00:00Z",
  "chunks": [
    {
      "id": "story-sql-performance",
      "type": "story",
      "title": "...",
      "text": "...",
      "org": "CardCastle",
      "period": "June 2022 - May 2026",
      "source": "story-chunks",
      "tags": ["performance"],
      "related": ["cardcastle-performance"],
      "file": "story-chunks.json",
      "hash": "...",
      "vector": [0.012, -0.034, "..."]
    }
  ]
}
```

## Loading it in the API

The API must embed visitor questions with the **same deployment** recorded in the index.

```csharp
public sealed record IndexedChunk(
    string Id, string Type, string Title, string Text, string? Org, string? Period,
    string Source, string[] Tags, string[] Related, string File, string Hash, float[] Vector);

public sealed record IndexFile(
    string EmbeddingDeployment, int Dimensions, DateTime CreatedUtc, List<IndexedChunk> Chunks);

public sealed class KnowledgeStore
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    private readonly IndexFile _index;
    private readonly Dictionary<string, IndexedChunk> _byId;

    public KnowledgeStore(string path)
    {
        _index = JsonSerializer.Deserialize<IndexFile>(File.ReadAllText(path), Json)!;
        _byId = _index.Chunks.ToDictionary(c => c.Id);
    }

    public string EmbeddingDeployment => _index.EmbeddingDeployment;

    public IEnumerable<(IndexedChunk Chunk, float Score)> Search(ReadOnlyMemory<float> query, int top = 4) =>
        _index.Chunks
            .Select(c => (Chunk: c, Score: TensorPrimitives.CosineSimilarity(query.Span, c.Vector)))
            .OrderByDescending(x => x.Score)
            .Take(top);

    // Pull in the chunks a hit points to (e.g. a story's reflection chunk).
    public IEnumerable<IndexedChunk> Related(IndexedChunk chunk) =>
        chunk.Related.Where(_byId.ContainsKey).Select(id => _byId[id]);
}
```

`TensorPrimitives` comes from the `System.Numerics.Tensors` package.

## Deploying

Run the tool locally or in CI whenever the chunk files change, then deploy `index.json` with the API (for example, copy it into the API project and set it to copy to the output directory). The API itself then needs only the chat and embedding deployments, not this tool.