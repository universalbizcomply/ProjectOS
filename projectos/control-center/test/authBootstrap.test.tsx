// @vitest-environment jsdom
//
// PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A — auth-bootstrap recovery proof.
// Uses only the installed stack: vitest + @testing-library/react (no jest-dom, no user-event).
//
// The defect under test: the initial `getSession()` probe could reject or stay pending
// forever, leaving the app permanently on "Loading…" with no error and no way forward.
// Every test here asserts the boot state EXITS by one of the permitted routes.
import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';

// The probe implementation is swapped per test. `vi.hoisted` keeps it reachable from the
// hoisted `vi.mock` factory below.
const probe = vi.hoisted(() => ({
  impl: (): Promise<Session | null> => Promise.resolve(null),
  // Subscribe/unsubscribe counters: retrying must not churn the auth-change subscription.
  subscribes: 0,
  unsubscribes: 0,
}));

vi.mock('../src/data/supabase', () => ({
  isSupabaseConfigured: true,
  getClient: () => null,
  fetchProjects: async () => ({ rows: [], source: 'seed' as const }),
}));

vi.mock('../src/data/auth', () => ({
  getSession: () => probe.impl(),
  onAuthChange: () => {
    probe.subscribes += 1;
    return () => {
      probe.unsubscribes += 1;
    };
  },
  signIn: async () => ({ error: null }),
  signOut: async () => {},
  updatePassword: async () => ({ error: null }),
  mustChangePassword: () => false,
}));

const { App } = await import('../src/App.js');

/** The bounded deadline in App.tsx; tests advance past it rather than waiting. */
const PROBE_TIMEOUT_MS = 10_000;

/** A session shaped enough for the auth gate (no real token material). */
const A_SESSION = { user: { id: 'owner', user_metadata: {} } } as unknown as Session;

/** A promise whose settlement the test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks (promise continuations) run inside React's act scope. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Advance past the probe deadline and flush the resulting state transition. */
async function passDeadline() {
  await act(async () => {
    vi.advanceTimersByTime(PROBE_TIMEOUT_MS + 1);
    await Promise.resolve();
  });
}

const booting = () => screen.queryByText('Loading…');
const retryButton = () => screen.queryByRole('button', { name: 'Try again' });
const signInHeading = () => screen.queryByRole('heading', { name: 'Sign in' });

let unhandled: unknown[] = [];
function recordUnhandled(reason: unknown) {
  unhandled.push(reason);
}

beforeEach(() => {
  vi.useFakeTimers();
  unhandled = [];
  probe.subscribes = 0;
  probe.unsubscribes = 0;
  process.on('unhandledRejection', recordUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', recordUnhandled);
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('auth bootstrap · probe outcomes', () => {
  // T1 — the probe resolves with a valid session: boot completes, session restored.
  test('T1 resolves with a session: boot completes and the auth gate opens', async () => {
    probe.impl = () => Promise.resolve(A_SESSION);
    render(<App />);
    await flush();

    expect(booting()).toBeNull();
    expect(retryButton()).toBeNull();
    // Gate opened: neither the sign-in screen nor the failure screen is shown.
    expect(signInHeading()).toBeNull();
  });

  // T2 — the probe resolves signed out: the sign-in screen is shown, no error loop.
  test('T2 resolves signed out: sign-in is shown without an error state', async () => {
    probe.impl = () => Promise.resolve(null);
    render(<App />);
    await flush();

    expect(booting()).toBeNull();
    expect(signInHeading()).not.toBeNull();
    expect(retryButton()).toBeNull();
  });

  // T3 — the probe rejects: boot exits to a retryable failure screen, rejection handled.
  test('T3 rejects: boot exits to a retryable failure screen with no unhandled rejection', async () => {
    probe.impl = () => Promise.reject(new Error('getaddrinfo ENOTFOUND supabase.co'));
    render(<App />);
    await flush();

    expect(booting()).toBeNull();
    expect(retryButton()).not.toBeNull();
    expect(unhandled).toHaveLength(0);
    // The raw failure is never surfaced to the user.
    expect(screen.queryByText(/ENOTFOUND/)).toBeNull();
    // Failure grants nothing: no session, so the dashboard never appears.
    expect(screen.queryByRole('button', { name: /Sign out/ })).toBeNull();
  });

  // T4 — the probe never settles: the deadline ends the boot state and offers retry.
  test('T4 stays pending past the deadline: boot exits and retry is offered', async () => {
    const pending = deferred<Session | null>();
    probe.impl = () => pending.promise;
    render(<App />);
    await flush();

    // Still booting before the deadline — the timeout, not a race, is what ends it.
    expect(booting()).not.toBeNull();

    await passDeadline();

    expect(booting()).toBeNull();
    expect(retryButton()).not.toBeNull();
  });

  // T5 — a late resolution after the deadline must not revive the stale boot.
  test('T5 resolves after the deadline: the late answer is dropped and state stays coherent', async () => {
    const pending = deferred<Session | null>();
    probe.impl = () => pending.promise;
    render(<App />);
    await flush();
    await passDeadline();
    expect(retryButton()).not.toBeNull();

    // The abandoned request finally answers — with a session.
    await act(async () => {
      pending.resolve(A_SESSION);
      await Promise.resolve();
    });

    // No duplicate transition: still the failure screen, and no session was adopted.
    expect(retryButton()).not.toBeNull();
    expect(booting()).toBeNull();
    expect(unhandled).toHaveLength(0);

    // The abandoned answer must not survive as latent state. Retry with a probe that is
    // still outstanding: the app must return to the boot state and wait for the FRESH
    // answer. If the dropped answer had been adopted, this window would instead render an
    // authenticated dashboard built from a session the user never successfully proved.
    const second = deferred<Session | null>();
    probe.impl = () => second.promise;
    await act(async () => {
      fireEvent.click(retryButton() as HTMLElement);
      await Promise.resolve();
    });
    await flush();

    expect(booting()).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Sign out/ })).toBeNull();
  });

  // T6 — unmounting before the probe settles must not update state afterwards.
  test('T6 unmounts before settlement: no state update and no warning after unmount', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferred<Session | null>();
    probe.impl = () => pending.promise;
    const { unmount } = render(<App />);
    await flush();
    // The deadline is armed while the probe is outstanding.
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    // Cleanup disarms it — an unmounted component must leave no pending timer behind.
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      pending.resolve(A_SESSION);
      await Promise.resolve();
    });
    // The deadline would also have fired had cleanup not cleared it.
    await act(async () => {
      vi.advanceTimersByTime(PROBE_TIMEOUT_MS + 1);
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
    expect(unhandled).toHaveLength(0);
  });

  // T7 — retry after a failure runs a fresh probe and recovers.
  test('T7 retry after failure: a fresh probe recovers the session state', async () => {
    probe.impl = () => Promise.reject(new Error('offline'));
    render(<App />);
    await flush();
    const retry = retryButton();
    expect(retry).not.toBeNull();

    // The network is back; the next probe answers signed out.
    probe.impl = () => Promise.resolve(null);
    await act(async () => {
      fireEvent.click(retry as HTMLElement);
      await Promise.resolve();
    });
    await flush();

    expect(retryButton()).toBeNull();
    expect(booting()).toBeNull();
    expect(signInHeading()).not.toBeNull();
  });

  // Repeated failure must stay retryable rather than latching or compounding.
  test('T7b repeated failures remain retryable', async () => {
    probe.impl = () => Promise.reject(new Error('offline'));
    render(<App />);
    await flush();

    for (let i = 0; i < 3; i += 1) {
      const retry = retryButton();
      expect(retry).not.toBeNull();
      await act(async () => {
        fireEvent.click(retry as HTMLElement);
        await Promise.resolve();
      });
      await flush();
    }

    expect(retryButton()).not.toBeNull();
    expect(unhandled).toHaveLength(0);
  });

  // T8 — the failure screen takes keyboard focus, so the transition is announced and the
  // retry control is one Tab away rather than a fresh document away.
  test('T8 failure screen moves focus to its heading', async () => {
    probe.impl = () => Promise.reject(new Error('offline'));
    render(<App />);
    await flush();

    const heading = screen.getByRole('heading', { name: 'Can’t reach sign-in' });
    expect(document.activeElement).toBe(heading);
  });

  // T9 — retrying re-arms the probe only. The auth-change subscription is a separate
  // lifetime concern; churning it on retry would re-fire its subscribe-time side effect.
  test('T9 retry re-probes without churning the auth-change subscription', async () => {
    probe.impl = () => Promise.reject(new Error('offline'));
    render(<App />);
    await flush();
    expect(probe.subscribes).toBe(1);

    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        fireEvent.click(retryButton() as HTMLElement);
        await Promise.resolve();
      });
      await flush();
    }

    expect(probe.subscribes).toBe(1);
    expect(probe.unsubscribes).toBe(0);
  });
});
