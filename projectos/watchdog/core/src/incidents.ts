// ProjectOS Watchdog Core — incident engine
// (incident-ownership.v1, positive-recovery.v1).
//
// Rules, enforced here and again by the database:
//   * a run plans only against incidents its OWN source owns; incidents of
//     other sources (runner, watchdog, ingest, sentinel...) are never touched
//   * recovery needs explicit PASS for the SAME identity from a run whose
//     results were committed; a missing result, ERROR, INFO or an uncommitted
//     (failed) run never recovers anything
//   * "the run did not report X, so close X" does not exist
//   * recovery is recorded first (recovered_at); the incident closes only when
//     the recovery notification is accepted (see notifications.ts)

import type { AlertingStatus, CheckStatus } from "./status.ts";
import { alertRank, isAlerting } from "./status.ts";
import type { IncidentIdentity } from "./identity.ts";
import { identityKey } from "./identity.ts";
import type { Metadata } from "./metadata.ts";

export type CheckResult = {
  check_id: string;
  scope_type: string;
  scope_id: string;
  status: CheckStatus;
  reason_code: string | null;
  metadata: Metadata;
};

export type IncidentState = "OPEN" | "RESOLVED" | "RETIRED";

export type Incident = IncidentIdentity & {
  incident_id: string;
  state: IncidentState;
  severity: AlertingStatus;
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
  opened_at: string;
  opening_run_id: string;
  last_notified_at: string | null;
  last_notified_severity: AlertingStatus | null;
  recovered_at: string | null;
  resolution_run_id: string | null;
  resolved_at: string | null;
};

export type RunContext = {
  run_id: string;
  project: string;
  environment: string;
  source: string;
  results_committed: boolean;
  now: string;
};

export type HoldReason = "missing" | "error" | "info" | "run_not_committed";

export type IncidentAction =
  | { kind: "open"; incident_id: string; identity: IncidentIdentity; severity: AlertingStatus }
  | { kind: "observe"; incident_id: string; severity: AlertingStatus }
  | { kind: "mark_recovered"; incident_id: string }
  | { kind: "hold"; incident_id: string; reason: HoldReason }
  // Recovery evidence was recorded earlier but this committed run did not
  // confirm health again (ERROR, INFO or missing): withdraw it, so a later
  // RECOVERY notice can never close the incident on a run that showed no PASS.
  | { kind: "clear_recovery"; incident_id: string; reason: Exclude<HoldReason, "run_not_committed"> };

export function resultIdentity(run: RunContext, r: CheckResult): IncidentIdentity {
  return {
    project: run.project,
    environment: run.environment,
    source: run.source,
    check_id: r.check_id,
    scope_type: r.scope_type,
    scope_id: r.scope_id,
  };
}

export function ownedOpenIncidents(open: readonly Incident[], run: RunContext): Incident[] {
  return open.filter((i) =>
    i.state === "OPEN" && i.project === run.project && i.environment === run.environment && i.source === run.source
  );
}

export function planIncidents(
  results: readonly CheckResult[],
  open: readonly Incident[],
  run: RunContext,
  newId: () => string,
): IncidentAction[] {
  const owned = ownedOpenIncidents(open, run);

  // A run whose results were not committed proves nothing: no opens, no
  // recoveries. Every owned incident is held open as it is.
  if (!run.results_committed) {
    return owned.map((i) => ({ kind: "hold", incident_id: i.incident_id, reason: "run_not_committed" }));
  }

  const byKey = new Map<string, Incident>();
  for (const i of owned) {
    const k = identityKey(i);
    if (byKey.has(k)) throw new Error("two open incidents share one identity: " + k);
    byKey.set(k, i);
  }

  const seen = new Set<string>();
  const actions: IncidentAction[] = [];
  const hold = (inc: Incident, reason: Exclude<HoldReason, "run_not_committed">): IncidentAction =>
    inc.recovered_at !== null
      ? { kind: "clear_recovery", incident_id: inc.incident_id, reason }
      : { kind: "hold", incident_id: inc.incident_id, reason };
  for (const r of results) {
    const identity = resultIdentity(run, r);
    const k = identityKey(identity);
    if (seen.has(k)) throw new Error("duplicate result for identity " + k);
    seen.add(k);
    const inc = byKey.get(k);

    if (isAlerting(r.status)) {
      if (!inc) {
        actions.push({ kind: "open", incident_id: newId(), identity, severity: r.status });
      } else if (r.status === "ERROR" && inc.severity !== "ERROR") {
        // The check could not establish health this time. That neither
        // confirms nor clears the known failure: keep it exactly as it is.
        actions.push(hold(inc, "error"));
      } else {
        actions.push({ kind: "observe", incident_id: inc.incident_id, severity: r.status });
      }
    } else if (r.status === "PASS") {
      if (inc) actions.push({ kind: "mark_recovered", incident_id: inc.incident_id });
    } else if (inc) {
      actions.push(hold(inc, "info"));
    }
  }

  for (const [k, inc] of byKey) {
    if (!seen.has(k)) actions.push(hold(inc, "missing"));
  }
  return actions;
}

// The owned incident set as it stands after the actions are persisted. Pure:
// used to plan notifications from state, which is what makes a failed
// notification retry on the next run without any extra bookkeeping.
export function projectIncidents(open: readonly Incident[], actions: readonly IncidentAction[], run: RunContext): Incident[] {
  const owned = new Map<string, Incident>();
  for (const i of ownedOpenIncidents(open, run)) owned.set(i.incident_id, { ...i });

  for (const a of actions) {
    if (a.kind === "open") {
      owned.set(a.incident_id, {
        ...a.identity,
        incident_id: a.incident_id,
        state: "OPEN",
        severity: a.severity,
        first_seen: run.now,
        last_seen: run.now,
        occurrence_count: 1,
        opened_at: run.now,
        opening_run_id: run.run_id,
        last_notified_at: null,
        last_notified_severity: null,
        recovered_at: null,
        resolution_run_id: null,
        resolved_at: null,
      });
      continue;
    }
    const cur = owned.get(a.incident_id);
    if (!cur) throw new Error("action for unknown or foreign incident " + a.incident_id);
    if (a.kind === "observe") {
      const lowered = cur.last_notified_severity !== null && alertRank(a.severity) < alertRank(cur.last_notified_severity);
      owned.set(a.incident_id, {
        ...cur,
        severity: a.severity,
        last_seen: run.now,
        occurrence_count: cur.occurrence_count + 1,
        // de-escalation lowers the notified watermark, so a later
        // re-escalation is announced again
        last_notified_severity: lowered ? a.severity : cur.last_notified_severity,
        // relapse after recovery evidence: the incident stays the same one
        recovered_at: null,
        resolution_run_id: null,
      });
    } else if (a.kind === "clear_recovery") {
      owned.set(a.incident_id, { ...cur, recovered_at: null, resolution_run_id: null });
    } else if (a.kind === "mark_recovered") {
      if (cur.recovered_at === null) {
        owned.set(a.incident_id, { ...cur, recovered_at: run.now, resolution_run_id: run.run_id });
      }
    }
  }
  return [...owned.values()];
}
