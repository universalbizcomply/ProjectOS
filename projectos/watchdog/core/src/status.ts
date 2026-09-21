// ProjectOS Watchdog Core — status contract (status.v1).
//
//   PASS      healthy, explicit positive evidence
//   INFO      informational; never opens an incident, never recovers one
//   WARN      degraded
//   CRITICAL  failing
//   ERROR     the check could not establish health
//
// ERROR is not PASS, not recovery, and not absence. A check that did not run
// is reported as ERROR, never silently omitted.

export const STATUSES = ["PASS", "INFO", "WARN", "CRITICAL", "ERROR"] as const;
export type CheckStatus = typeof STATUSES[number];

export const ALERTING_STATUSES = ["WARN", "ERROR", "CRITICAL"] as const;
export type AlertingStatus = typeof ALERTING_STATUSES[number];

export function isStatus(v: unknown): v is CheckStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

export function parseStatus(v: unknown): CheckStatus {
  if (!isStatus(v)) throw new Error("invalid watchdog status: " + JSON.stringify(v));
  return v;
}

export function isAlerting(s: CheckStatus): s is AlertingStatus {
  return s === "WARN" || s === "ERROR" || s === "CRITICAL";
}

// Notification urgency. ERROR (monitoring blind) ranks above WARN and below a
// confirmed CRITICAL failure.
export function alertRank(s: CheckStatus | null): number {
  switch (s) {
    case "WARN": return 1;
    case "ERROR": return 2;
    case "CRITICAL": return 3;
    default: return 0;
  }
}

// Reason codes attached by the core when it synthesises a result.
export const REASON_NOT_REPORTED = "NOT_REPORTED";
export const REASON_PACK_FAILED = "PACK_FAILED";
export const REASON_INVALID_RESULT = "INVALID_RESULT";
export const SYNTHESISED_REASONS: readonly string[] = [REASON_NOT_REPORTED, REASON_PACK_FAILED, REASON_INVALID_RESULT];
