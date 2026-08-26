/**
 * Two visual shells over ONE engine (PROJECTOS-PRODUCT-COMPLETION1A §26).
 *
 * STANDARD is the calm, practical workspace. COMMAND CENTRE is the darker, layered presentation.
 *
 * THE MODE CHANGES APPEARANCE AND NOTHING ELSE. It is a class on the root element and a persisted
 * string; it is not passed to any component, not read by any model, and not consulted by any code
 * that decides what may happen. Authority, workflow, state, project data, capability and every
 * governed refusal are identical in both — and they have to be, because a "mode" that changed what
 * the owner could do would be a second product with half the testing.
 *
 * Persisted in `localStorage` deliberately: it is a per-viewer convenience, not governed state, so it
 * has no business in a `.projectops` record. Every access is guarded — a browser with site data
 * blocked throws on read, and the correct response to that is the default theme, not a broken app.
 */
import { useCallback, useEffect, useState } from 'react';

export type ShellTheme = 'standard' | 'command';

const STORAGE_KEY = 'projectos.shell-theme';
const DEFAULT_THEME: ShellTheme = 'standard';

function isTheme(value: unknown): value is ShellTheme {
  return value === 'standard' || value === 'command';
}

/** Read the remembered theme, or the default. Never throws. */
function readTheme(): ShellTheme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Remember the theme. A failure to persist is not a failure to switch. */
function writeTheme(theme: ShellTheme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* A viewer with site data blocked still gets the theme for this session. */
  }
}

/**
 * The current shell theme and a setter. Applying it is a side effect on the document root, so the
 * whole tree restyles without a single component needing to know which mode is active.
 */
export function useShellTheme(): { theme: ShellTheme; setTheme: (next: ShellTheme) => void } {
  const [theme, setThemeState] = useState<ShellTheme>(() => readTheme());

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-shell', theme);
    return () => root.removeAttribute('data-shell');
  }, [theme]);

  const setTheme = useCallback((next: ShellTheme) => {
    setThemeState(next);
    writeTheme(next);
  }, []);

  return { theme, setTheme };
}

/**
 * The switch itself, restyled as the rail's raised-pill segmented control. A real radio group, so
 * it is operable by keyboard and announced as a choice between two named options rather than as a
 * pair of unrelated buttons — the mechanism is unchanged, only its clothes.
 */
export function ShellThemeToggle({
  theme,
  setTheme,
}: {
  theme: ShellTheme;
  setTheme: (next: ShellTheme) => void;
}) {
  return (
    <div className="os-seg" role="radiogroup" aria-label="Appearance">
      <button
        type="button"
        role="radio"
        aria-checked={theme === 'standard'}
        onClick={() => setTheme('standard')}
      >
        Standard
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={theme === 'command'}
        onClick={() => setTheme('command')}
      >
        Command
      </button>
    </div>
  );
}
