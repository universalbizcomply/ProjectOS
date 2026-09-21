// ProjectOS Watchdog Core — notification planner (notification-truth.v1).
//
// Notifications are DERIVED from incident state, never queued separately:
//   OPEN, never notified                      -> INITIAL
//   OPEN, severity above the notified level   -> ESCALATION (ignores cooldown)
//   OPEN, cooldown for its severity elapsed   -> REMINDER
//   OPEN with positive recovery evidence      -> RECOVERY
// Only an ACCEPTED delivery advances state (last_notified_*, or closing the
// incident for RECOVERY). A failed delivery leaves state untouched, so the
// same notification is planned again next run: a possible duplicate, never a
// lost alert. Transport is abstract; nothing here depends on a provider.

import type { AlertingStatus } from "./status.ts";
import { ALERTING_STATUSES, alertRank } from "./status.ts";
import type { IncidentIdentity } from "./identity.ts";
import type { Incident } from "./incidents.ts";

export type NotificationKind = "INITIAL" | "ESCALATION" | "REMINDER" | "RECOVERY";

export type CooldownPolicy = Readonly<Record<AlertingStatus, number>>; // milliseconds

// Reference values only: WARN and CRITICAL are the reviewed JD values
// (MONITORING1A); ERROR is provisional. Production values are set per product
// before rollout.
export const REFERENCE_COOLDOWNS_MS: CooldownPolicy = {
  WARN: 24 * 60 * 60 * 1000,
  ERROR: 6 * 60 * 60 * 1000,
  CRITICAL: 60 * 60 * 1000,
};

export type PlannedNotification = {
  incident_id: string;
  kind: NotificationKind;
  severity: AlertingStatus;
  identity: IncidentIdentity;
  opened_at: string;
};

export type NotificationBatch = {
  project: string;
  environment: string;
  generated_at: string;
  notifications: PlannedNotification[];
};

export type DeliveryResult = { accepted: boolean; code: string };

export interface NotificationTransport {
  send(batch: NotificationBatch): Promise<DeliveryResult>;
}

export function assertCooldownPolicy(p: CooldownPolicy): void {
  for (const s of ALERTING_STATUSES) {
    const v = p[s];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new Error("invalid cooldown for " + s);
  }
}

function identityOf(i: Incident): IncidentIdentity {
  return {
    project: i.project, environment: i.environment, source: i.source,
    check_id: i.check_id, scope_type: i.scope_type, scope_id: i.scope_id,
  };
}

export function planNotifications(incidents: readonly Incident[], nowIso: string, policy: CooldownPolicy): PlannedNotification[] {
  assertCooldownPolicy(policy);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) throw new Error("invalid now");
  const out: PlannedNotification[] = [];
  for (const i of incidents) {
    if (i.state !== "OPEN") continue;
    let kind: NotificationKind | null = null;
    if (i.recovered_at !== null) {
      kind = "RECOVERY";
    } else if (i.last_notified_at === null) {
      kind = "INITIAL";
    } else if (alertRank(i.severity) > alertRank(i.last_notified_severity)) {
      kind = "ESCALATION";
    } else {
      const last = Date.parse(i.last_notified_at);
      if (!Number.isFinite(last)) throw new Error("invalid last_notified_at on " + i.incident_id);
      if (now - last >= policy[i.severity]) kind = "REMINDER";
    }
    if (kind) out.push({ incident_id: i.incident_id, kind, severity: i.severity, identity: identityOf(i), opened_at: i.opened_at });
  }
  return out;
}

// State after a delivery outcome. Failed -> unchanged (retryable).
export function applyDelivery(i: Incident, kind: NotificationKind, accepted: boolean, nowIso: string): Incident {
  if (!accepted) return i;
  if (kind === "RECOVERY") {
    if (i.recovered_at === null) throw new Error("recovery notice without recovery evidence");
    return { ...i, state: "RESOLVED", resolved_at: nowIso };
  }
  return { ...i, last_notified_at: nowIso, last_notified_severity: i.severity };
}
