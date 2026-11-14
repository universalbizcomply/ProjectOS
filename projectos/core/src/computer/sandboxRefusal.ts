// Origin: original ProjectOS code
/**
 * The browser and computer-use interfaces, and the answer every call to them gets until Stage 4.3.
 *
 * EVERY CALL REFUSES. A browser call or a computer-use call returns `SANDBOX_NOT_AVAILABLE` and does nothing else: it reads
 * no argument, consults no policy, and cannot be made to succeed by a policy that allows it, because there is no sandbox for
 * the action to run in. A policy that says yes to a click is a statement about permission and not a browser. The interfaces
 * exist so the code that will drive a sandboxed browser and computer is written against a contract now, and the refusing
 * implementations are the only ones in this tree.
 *
 * NO SIGNED-IN BROWSER, NO VAULT. The interfaces name no profile, no cookie store, no credential vault and no TOTP: there is
 * nothing in them through which a call could attach to the owner's own browser or fill a credential.
 *
 * Pure: no I/O.
 */

export const SANDBOX_NOT_AVAILABLE = 'SANDBOX_NOT_AVAILABLE';
export const SANDBOX_AVAILABLE_FROM = 'Stage 4.3';

export type SandboxSurface = 'browser' | 'computer-use';

export interface SandboxRefusal {
  readonly ok: false;
  readonly code: typeof SANDBOX_NOT_AVAILABLE;
  readonly surface: SandboxSurface;
  readonly call: string;
  readonly availableFrom: typeof SANDBOX_AVAILABLE_FROM;
}

export const BROWSER_CALLS = ['open', 'navigate', 'snapshot', 'click', 'type', 'screenshot', 'close'] as const;
export type BrowserCall = (typeof BROWSER_CALLS)[number];
export const COMPUTER_USE_CALLS = ['screenshot', 'click', 'type', 'key', 'scroll', 'listFiles', 'readFile', 'writeFile', 'downloadFile', 'runCommand'] as const;
export type ComputerUseCall = (typeof COMPUTER_USE_CALLS)[number];

/** One call of the browser. The arguments are whatever a future sandbox will take; today none is read. */
export type BrowserPort = { readonly [Call in BrowserCall]: (...args: readonly unknown[]) => SandboxRefusal };
export type ComputerUsePort = { readonly [Call in ComputerUseCall]: (...args: readonly unknown[]) => SandboxRefusal };

/** The refusal for one call, as data. */
export function refuseSandboxCall(surface: SandboxSurface, call: string): SandboxRefusal {
  return Object.freeze({ ok: false, code: SANDBOX_NOT_AVAILABLE, surface, call, availableFrom: SANDBOX_AVAILABLE_FROM });
}

function refusing<Call extends string>(surface: SandboxSurface, calls: readonly Call[]): { readonly [C in Call]: (...args: readonly unknown[]) => SandboxRefusal } {
  const port = {} as { [C in Call]: (...args: readonly unknown[]) => SandboxRefusal };
  for (const call of calls) port[call] = () => refuseSandboxCall(surface, call);
  return Object.freeze(port);
}

/** The browser port every caller gets until Stage 4.3. */
export const createRefusingBrowser = (): BrowserPort => refusing('browser', BROWSER_CALLS);
/** The computer-use port every caller gets until Stage 4.3. */
export const createRefusingComputerUse = (): ComputerUsePort => refusing('computer-use', COMPUTER_USE_CALLS);
