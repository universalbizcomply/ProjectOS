/**
 * Voice input — wired where the platform actually provides it, and visibly unavailable where it
 * does not.
 *
 * THE HANDOFF IS EXPLICIT THAT VOICE IS A DESIGNED STATE, NOT A MICROPHONE HOOKUP (README §Open
 * questions 2). The instruction is to wire real speech-to-text if it is already available without
 * expanding scope, and otherwise to show the control in its designed state as unavailable — never
 * to ship a button that pretends.
 *
 * So this feature-detects the browser's own SpeechRecognition and does exactly one of two things.
 * Where it exists (a Chromium browser with the speech service) the mic really transcribes into the
 * composer. Where it does not — which includes the installed WebView2 desktop app today — `supported`
 * is false, the control renders in place and disabled, and it says why. Nothing is faked in either
 * direction, and no new dependency, permission or host command was added to find out.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechResultAlternative {
  readonly transcript: string;
}
interface SpeechResult {
  readonly length: number;
  readonly isFinal: boolean;
  readonly [index: number]: SpeechResultAlternative;
}
interface SpeechResultList {
  readonly length: number;
  readonly [index: number]: SpeechResult;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { readonly resultIndex: number; readonly results: SpeechResultList }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recogniser(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = (w['SpeechRecognition'] ?? w['webkitSpeechRecognition']) as SpeechRecognitionCtor | undefined;
  return typeof ctor === 'function' ? ctor : null;
}

export interface VoiceInput {
  /** Whether this platform can actually transcribe. False in the installed desktop app today. */
  readonly supported: boolean;
  readonly listening: boolean;
  readonly toggle: () => void;
  readonly stop: () => void;
  /** The one sentence shown when the control is unavailable. */
  readonly unavailableReason: string;
}

export const VOICE_UNAVAILABLE =
  'Talking to ProjectOS is not available on this computer yet — type it instead.';

/** Drive the mic. `onTranscript` receives finalised text, to be appended to the composer draft. */
export function useVoiceInput(onTranscript: (text: string) => void): VoiceInput {
  const [listening, setListening] = useState(false);
  const ref = useRef<SpeechRecognitionLike | null>(null);
  const callback = useRef(onTranscript);
  callback.current = onTranscript;

  const supported = recogniser() !== null;

  const stop = useCallback(() => {
    ref.current?.stop();
    ref.current = null;
    setListening(false);
  }, []);

  useEffect(() => () => { ref.current?.stop(); ref.current = null; }, []);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
      return;
    }
    const Ctor = recogniser();
    if (Ctor === null) return;
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-GB';
    rec.onresult = (event) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result !== undefined && result.isFinal) text += result[0]?.transcript ?? '';
      }
      if (text.trim() !== '') callback.current(text.trim());
    };
    rec.onerror = () => { ref.current = null; setListening(false); };
    rec.onend = () => { ref.current = null; setListening(false); };
    ref.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      ref.current = null;
      setListening(false);
    }
  }, [listening, stop]);

  return { supported, listening, toggle, stop, unavailableReason: VOICE_UNAVAILABLE };
}
