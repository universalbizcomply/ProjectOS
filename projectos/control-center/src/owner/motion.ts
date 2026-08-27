/**
 * Softer motion, and the cursor parallax.
 *
 * TWO SWITCHES, ONE OUTCOME. `prefers-reduced-motion` is the viewer's own setting and is honoured
 * in CSS; **Softer motion** in Settings is the owner's, and writes `data-calm="1"` on the document
 * root so the same CSS turns everything off. Neither is passed to a component, a model or a
 * command — like the appearance mode, this is presentation and nothing else.
 *
 * PARALLAX WRITES TWO NUMBERS AND READS NOTHING. A passive `mousemove` sets `--px` / `--py` on the
 * document root; every consumer has a `,0` fallback, so a keyboard-only session — where those
 * custom properties are never written at all — is completely unaffected.
 */
import { useCallback, useEffect, useState } from 'react';

const CALM_KEY = 'projectos.calm-motion';

function readCalm(): boolean {
  try {
    return window.localStorage.getItem(CALM_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCalm(calm: boolean): void {
  try {
    window.localStorage.setItem(CALM_KEY, calm ? '1' : '0');
  } catch {
    /* A viewer with site data blocked still gets the setting for this session. */
  }
}

/** The Softer motion switch. Applying it is a side effect on the document root. */
export function useCalmMotion(): { calm: boolean; setCalm: (next: boolean) => void } {
  const [calm, setCalmState] = useState<boolean>(() => readCalm());

  useEffect(() => {
    const root = document.documentElement;
    if (calm) root.setAttribute('data-calm', '1');
    else root.removeAttribute('data-calm');
    return () => root.removeAttribute('data-calm');
  }, [calm]);

  const setCalm = useCallback((next: boolean) => {
    setCalmState(next);
    writeCalm(next);
  }, []);

  return { calm, setCalm };
}

/**
 * Cursor parallax for the Command-mode atmosphere. Off entirely when either switch says so, and
 * the properties are removed on the way out so a paused layer settles at its resting position.
 */
export function useParallax(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const root = document.documentElement;
    const onMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      const y = (e.clientY / window.innerHeight - 0.5) * 2;
      root.style.setProperty('--px', x.toFixed(3));
      root.style.setProperty('--py', y.toFixed(3));
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      root.style.removeProperty('--px');
      root.style.removeProperty('--py');
    };
  }, [enabled]);
}

/** A ticking wall clock, for the dashboard's SYSTEM TIME readout. */
export function useClock(enabled: boolean): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}
