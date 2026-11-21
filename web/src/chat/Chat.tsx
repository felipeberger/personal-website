import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import CvView from '../cv/CvView';
import { ChatError, streamChat, type ChatTurn } from './streamChat';
import { downloadCvPdf } from '../cv/CvPdf';

const DEFAULT_PROMPT = "Show me Felipe's CV";
const MAX_INPUT = 600; // matches the API's limit for visitor messages
const MAX_MESSAGES = 12; // matches the API's limit per request
const FOLLOW_THRESHOLD = 120; // px from the bottom that still counts as "at the bottom"

const SUGGESTIONS = [
  'What is his experience with Ruby on Rails?',
  'What is his experience with Rust?',
  'What are his main software skills?',
  'What is his consulting experience?',
  'Which roles is he looking for?',
  'Is he available to start now?',
  'Download CV',
];

interface UiMessage extends ChatTurn {
  cv?: boolean; // render the CV under this assistant message
}

/** Short "show me the CV" requests are answered locally with the rendered CV, no API call. */
function isCvRequest(q: string): boolean {
  const words = q.trim().split(/\s+/).length;
  return words <= 8 && /(^|\W)(cv|resume|résumé)(\W|$)/i.test(q);
}

/** Detect "download/save/export CV" requests. */
function isDownloadCvRequest(q: string): boolean {
  const words = q.trim().split(/\s+/).length;
  return words <= 8 &&
    /(^|\W)(download|save|export|get)(\W|$)/i.test(q) &&
    /(cv|resume|résumé)/i.test(q);
}

export default function Chat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState(DEFAULT_PROMPT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cvRef = useRef<HTMLDivElement>(null); // the latest CV message
  const followRef = useRef(true); // keep the newest text in view?
  const showCvTopRef = useRef(false); // on the next render, scroll to the start of the CV

  const started = messages.length > 0;

  // Follow the newest text, unless the visitor has scrolled up to read something.
  useEffect(() => {
    const onScroll = () => {
      const distance = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      followRef.current = distance < FOLLOW_THRESHOLD;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (showCvTopRef.current && cvRef.current) {
      // A CV is long: start reading at its top instead of jumping to its end.
      showCvTopRef.current = false;
      followRef.current = false;
      cvRef.current.scrollIntoView({ block: 'start' });
    } else if (followRef.current && started) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  }, [messages, error, started]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    setError(null);
    setInput('');
    const asked: UiMessage = { role: 'user', content: question };

    if (isDownloadCvRequest(question)) {
      setMessages((prev) => [...prev, asked, { role: 'assistant', content: 'Preparing your CV download...' }]);
      try {
        await downloadCvPdf();
        setMessages((prev) => [...prev.slice(0, -1), { role: 'assistant', content: "CV downloaded! Check your downloads folder." }]);
      } catch {
        setMessages((prev) => [...prev.slice(0, -1), { role: 'assistant', content: "Sorry, couldn't generate the PDF. Try again?" }]);
      }
      return;
    }

    if (isCvRequest(question)) {
      showCvTopRef.current = true;
      setMessages((prev) => [...prev, asked, { role: 'assistant', content: "Here's Felipe's CV.", cv: true }]);
      return;
    }

    // The visitor just asked something: show the new answer as it streams in.
    followRef.current = true;
    const outgoing = [...messages, asked];
    setMessages([...outgoing, { role: 'assistant', content: '' }]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        outgoing.slice(-MAX_MESSAGES).map(({ role, content }) => ({ role, content })),
        {
          onDelta: (t) =>
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              return [...prev.slice(0, -1), { ...last, content: last.content + t }];
            }),
        },
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof ChatError ? e.message : 'Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
      // Drop an empty placeholder so it is never sent back to the API (it rejects empty messages).
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return last?.role === 'assistant' && last.content === '' ? prev.slice(0, -1) : prev;
      });
    }
  }

  function newChat() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setBusy(false);
    setInput(DEFAULT_PROMPT);
    followRef.current = true;
    window.scrollTo({ top: 0 });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <main className={`page ${started ? 'started' : 'landing'}`}>
      {started ? (
        <header className="topbar">
          <span>Felipe Berger</span>
          <button type="button" onClick={newChat}>
            New chat
          </button>
        </header>
      ) : (
        <header className="hero">
          <h1>Felipe Berger</h1>
          <p>Backend engineer in Canberra. Ask about his work, projects and skills.</p>
        </header>
      )}

      {started && (
        <div className="log" role="log" aria-live="polite" aria-busy={busy}>
          {messages.map((m, i) => (
            <div key={i} ref={m.cv ? cvRef : undefined} className={`msg ${m.role}`}>
              {m.content || <span className="thinking">Thinking</span>}
              {m.cv && <CvView />}
            </div>
          ))}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <form className="composer" onSubmit={onSubmit}>
        <label htmlFor="question" className="sr-only">
          Your question
        </label>
        <textarea
          id="question"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            // The prefilled question is replaced by typing, not edited.
            if (e.target.value === DEFAULT_PROMPT) e.target.select();
          }}
          maxLength={MAX_INPUT}
          rows={started ? 2 : 3}
          placeholder={started ? 'Ask a follow-up' : 'Ask about his experience, projects or availability'}
        />
        <div className="composer-actions">
          {busy ? (
            <button type="button" className="icon" aria-label="Stop" onClick={() => abortRef.current?.abort()}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button type="submit" className="icon" aria-label="Send" disabled={!input.trim()}>
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </form>

      {!started && (
        <ul className="suggestions">
          {SUGGESTIONS.map((q) => (
            <li key={q}>
              <button type="button" onClick={() => void send(q)}>
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
