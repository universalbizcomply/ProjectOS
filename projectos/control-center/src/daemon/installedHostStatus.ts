/**
 * The READ-ONLY installed-host status the Control Centre displays.
 *
 * CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A.
 *
 * The host answers with seven closed values and two safe display fields. This module parses that
 * answer and NOTHING else: it computes no status of its own, and every parse failure collapses to
 * the unavailable view. Unverified data can therefore never be rendered as Verified or Ready.
 *
 * It shows no installation ID, no raw identity record, no filesystem path, no secret and no
 * capability — the host does not send them, and nothing here can invent them.
 */
import type { IpcBridge } from './ipcBridge.js';

/** The Tauri command backing this read. Read-only: it changes nothing on the host. */
export const INSTALLED_HOST_STATUS_COMMAND = 'installed_host_status';

/** The value shown for any fact the host did not supply. */
export const UNAVAILABLE = 'UNAVAILABLE';

export interface InstalledHostStatusView {
  readonly serviceState: string;
  readonly identityVerification: string;
  readonly channel: string;
  readonly buildPrefix: string;
  readonly manifestPrefix: string;
  readonly readiness: string;
  readonly protectedOperations: string;
  readonly readSucceeded: boolean;
  readonly nextSafeAction: string;
}

/** Every fact unavailable. The ONLY shape any failure may produce. */
export function unavailableView(nextSafeAction: string): InstalledHostStatusView {
  return {
    serviceState: UNAVAILABLE,
    identityVerification: UNAVAILABLE,
    channel: UNAVAILABLE,
    buildPrefix: UNAVAILABLE,
    manifestPrefix: UNAVAILABLE,
    readiness: UNAVAILABLE,
    protectedOperations: UNAVAILABLE,
    readSucceeded: false,
    nextSafeAction,
  };
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Parse the host's JSON answer. A missing, non-string or malformed field makes the WHOLE view
 * unavailable — a partially parsed answer is never displayed.
 */
export function parseInstalledHostStatus(raw: unknown): InstalledHostStatusView {
  if (typeof raw !== 'string') {
    return unavailableView('The installed host did not answer, so no status is shown.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unavailableView("The installed host's answer could not be read, so no status is shown.");
  }
  if (parsed === null || typeof parsed !== 'object') {
    return unavailableView("The installed host's answer could not be read, so no status is shown.");
  }
  const o = parsed as Record<string, unknown>;
  const serviceState = str(o.serviceState);
  const identityVerification = str(o.identityVerification);
  const channel = str(o.channel);
  const buildPrefix = str(o.buildPrefix);
  const manifestPrefix = str(o.manifestPrefix);
  const readiness = str(o.readiness);
  const protectedOperations = str(o.protectedOperations);
  const nextSafeAction = str(o.nextSafeAction) ?? 'The installed host answered.';
  if (
    serviceState === null ||
    identityVerification === null ||
    channel === null ||
    buildPrefix === null ||
    manifestPrefix === null ||
    readiness === null ||
    protectedOperations === null
  ) {
    return unavailableView("The installed host's answer was incomplete, so no status is shown.");
  }
  return {
    serviceState,
    identityVerification,
    channel,
    buildPrefix,
    manifestPrefix,
    readiness,
    protectedOperations,
    // Only the host may say the read succeeded. Anything other than an explicit `true` is a failure.
    readSucceeded: o.readSucceeded === true,
    nextSafeAction,
  };
}

/**
 * Perform ONE read. Outside Tauri, and on any transport error, the unavailable view is returned —
 * the browser build shows no status rather than a fabricated one.
 */
export async function readInstalledHostStatus(
  bridge: IpcBridge,
): Promise<InstalledHostStatusView> {
  if (!bridge.isTauri()) {
    return unavailableView('The installed host is only readable from the desktop app.');
  }
  try {
    return parseInstalledHostStatus(await bridge.invoke(INSTALLED_HOST_STATUS_COMMAND));
  } catch {
    return unavailableView('The installed host could not be reached, so no status is shown.');
  }
}
