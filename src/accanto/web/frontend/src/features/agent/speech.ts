import { useEffect, useRef, useState } from "react";

/**
 * Speech input through the browser's own recognizer (the Web Speech API). The browser sends the
 * audio to its vendor's service (Google in Chrome, Apple in Safari, Microsoft in Edge) or keeps it
 * on the device; Accanto receives only the text the owner then sends.
 */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type Recognizer = (new () => Recognition) & {
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
};

/**
 * Every iOS browser runs WebKit, whose recognizer hears only silence after its first session in
 * iOS 27 (WebKit bug 326069). The keyboard's own dictation keeps working there.
 */
function recognizer(): Recognizer | undefined {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1))
    return undefined;
  const w = window as unknown as Record<string, Recognizer | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const BLOCKED =
  "Microphone access is off for this site. Allow it in the browser's site settings, or type instead.";
const FAILED: Record<string, string> = {
  "not-allowed": BLOCKED,
  "service-not-allowed": BLOCKED,
  "audio-capture": "No microphone was found. Type instead.",
};

/**
 * One spoken message at a time: `start(before)` writes `before` plus what is heard as it is heard,
 * and a pause, `stop()` or `stop(true)` ends it. `stop(true)` also drops words still arriving, for
 * when the owner types or sends. Null where the browser cannot listen.
 */
export function useSpeech(write: (text: string) => void, fail: (message: string) => void) {
  const [listening, setListening] = useState(false);
  const current = useRef<Recognition | null>(null);
  const local = useRef(false);
  const supported = Boolean(recognizer());

  useEffect(() => {
    // Chrome can recognize on the device once its language pack is installed: prefer that.
    recognizer()
      ?.available?.({ langs: [navigator.language], processLocally: true })
      .then((status) => {
        local.current = status === "available";
      })
      .catch(() => {});
    return () => current.current?.abort();
  }, []);

  if (!supported) return null;
  return {
    listening,
    start(before: string) {
      const Recognizer = recognizer();
      if (!Recognizer || current.current) return;
      const rec = new Recognizer();
      rec.lang = navigator.language;
      rec.interimResults = true;
      // One utterance: a pause ends it.
      rec.continuous = false;
      if (local.current) rec.processLocally = true;
      rec.onresult = (event) => {
        if (current.current !== rec) return;
        write(before + Array.from(event.results, (result) => result[0]?.transcript ?? "").join(""));
      };
      rec.onerror = (event) => {
        if (current.current !== rec || event.error === "aborted" || event.error === "no-speech")
          return;
        fail(FAILED[event.error] ?? "Speech isn't available right now. Type instead.");
      };
      rec.onend = () => {
        if (current.current !== rec) return;
        current.current = null;
        setListening(false);
      };
      current.current = rec;
      setListening(true);
      try {
        rec.start();
      } catch {
        current.current = null;
        setListening(false);
        fail("Speech isn't available right now. Type instead.");
      }
    },
    stop(discard = false) {
      const rec = current.current;
      if (!rec) return;
      if (!discard) return rec.stop();
      current.current = null;
      setListening(false);
      rec.abort();
    },
  };
}
