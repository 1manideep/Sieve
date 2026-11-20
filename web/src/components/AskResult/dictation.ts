// Dictation for the prompt card's mic: Chrome's SpeechRecognition when it exists (the mic is hidden otherwise).
// The transcript goes into the question field; nothing is sent anywhere by Sieve itself.
import { useEffect, useRef, useState } from 'react';

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

export function speechRecognition(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface Dictation {
  supported: boolean;
  listening: boolean;
  toggle(): void;
}

export function useDictation(onText: (text: string) => void): Dictation {
  const [listening, setListening] = useState(false);
  const current = useRef<Recognition | null>(null);
  const latest = useRef(onText);
  const Ctor = speechRecognition();

  useEffect(() => {
    latest.current = onText;
  });
  useEffect(() => () => current.current?.abort(), []);

  const toggle = () => {
    if (current.current) {
      current.current.stop();
      return;
    }
    if (!Ctor) return;
    let rec: Recognition;
    try {
      rec = new Ctor();
    } catch {
      return;
    }
    rec.lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event) => {
      const parts: string[] = [];
      for (let i = 0; i < event.results.length; i += 1) parts.push(event.results[i][0]?.transcript ?? '');
      latest.current(parts.join(' ').trim());
    };
    rec.onend = () => {
      current.current = null;
      setListening(false);
    };
    rec.onerror = () => {
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
    }
  };

  return { supported: Ctor !== null, listening, toggle };
}
