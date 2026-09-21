// Test helpers: an in-memory WatchdogStore that enforces the same rules as the
// SQL schema (ownership, evidence-backed opens, positive recovery, recovery
// notice closes), plus fixtures.

import type { AlertingStatus } from "../src/status.ts";
import type { CheckResult, Incident } from "../src/incidents.ts";
import type { NotificationBatch, NotificationKind, NotificationTransport, DeliveryResult } from "../src/notifications.ts";
import type { StoreStatus, WatchdogStore } from "../src/runner.ts";
import { SYNTHESISED_REASONS } from "../src/status.ts";

type Run = { run_id: string; source: string; status: string; committed: boolean; expected: number; results: CheckResult[] };

export class MemoryStore implements WatchdogStore {
  project = "demo";
  environment = "production";
  schema_version: number | null = 1;
  installed_core_version: string | null = "0.1.0";
  clock = Date.parse("2026-09-21T10:00:00.000Z");
  runs = new Map<string, Run>();
  incidents = new Map<string, Incident>();
  notified: Array<{ incident_id: string; kind: NotificationKind }> = [];
  failuresLogged = 0;
  failOn: Partial<Record<string, string>> = {};
  commitSkew = 0;
  refuseOpenFor = new Set<string>();
  refuseMarkFor = new Set<string>();
  jobEvents: string[] = [];

  now(): string { return new Date(this.clock).toISOString(); }
  advance(ms: number): void { this.clock += ms; }
  private maybeFail(op: string): void { if (this.failOn[op]) throw new Error(this.failOn[op]); }
  private run(id: string): Run { const r = this.runs.get(id); if (!r) throw new Error("unknown run"); return r; }

  async status(): Promise<StoreStatus> {
    this.maybeFail("status");
    return { project: this.project, environment: this.environment, schema_version: this.schema_version, installed_core_version: this.installed_core_version, db_now: this.now() };
  }
  async runStart(r: { run_id: string; source: string; expected_check_count: number }): Promise<void> {
    this.maybeFail("runStart");
    this.runs.set(r.run_id, { run_id: r.run_id, source: r.source, status: "STARTED", committed: false, expected: r.expected_check_count, results: [] });
  }
  async recordResults(run_id: string, results: CheckResult[]): Promise<void> {
    this.maybeFail("recordResults");
    this.run(run_id).results.push(...results);
  }
  async commitResults(run_id: string): Promise<{ actual_check_count: number; db_now: string }> {
    this.maybeFail("commitResults");
    const r = this.run(run_id);
    const ids = new Set(r.results.map((x) => x.check_id));
    if (ids.size < r.expected) throw new Error("not every declared check has a result");
    r.committed = true;
    const genuine = new Set(r.results.filter((x) => x.reason_code === null || !SYNTHESISED_REASONS.includes(x.reason_code)).map((x) => x.check_id));
    return { actual_check_count: genuine.size + this.commitSkew, db_now: this.now() };
  }
  async openIncidents(source: string): Promise<Incident[]> {
    this.maybeFail("openIncidents");
    return [...this.incidents.values()].filter((i) => i.state === "OPEN" && i.source === source).map((i) => ({ ...i }));
  }
  private evidence(run: Run, i: { check_id: string; scope_type: string; scope_id: string }, status: string): boolean {
    return run.results.some((r) => r.check_id === i.check_id && r.scope_type === i.scope_type && r.scope_id === i.scope_id && r.status === status);
  }
  async openIncident(run_id: string, incident_id: string, r: { check_id: string; scope_type: string; scope_id: string }, severity: AlertingStatus): Promise<void> {
    this.maybeFail("openIncident");
    const run = this.run(run_id);
    if (!run.committed || !this.evidence(run, r, severity)) throw new Error("open without committed evidence");
    if (this.refuseOpenFor.has(r.check_id)) throw new Error("refused by database");
    for (const i of this.incidents.values()) {
      if (i.state === "OPEN" && i.source === run.source && i.check_id === r.check_id && i.scope_type === r.scope_type && i.scope_id === r.scope_id) throw new Error("duplicate open identity");
    }
    const now = this.now();
    this.incidents.set(incident_id, {
      project: this.project, environment: this.environment, source: run.source, ...r, incident_id, state: "OPEN", severity,
      first_seen: now, last_seen: now, occurrence_count: 1, opened_at: now, opening_run_id: run_id,
      last_notified_at: null, last_notified_severity: null, recovered_at: null, resolution_run_id: null, resolved_at: null,
    });
  }
  async observeIncident(run_id: string, incident_id: string, severity: AlertingStatus): Promise<void> {
    this.maybeFail("observeIncident");
    const run = this.run(run_id);
    const i = this.incidents.get(incident_id);
    if (!i || i.state !== "OPEN" || i.source !== run.source || !run.committed || !this.evidence(run, i, severity)) throw new Error("observe rejected");
    const rank = { WARN: 1, ERROR: 2, CRITICAL: 3 } as const;
    const lowered = i.last_notified_severity !== null && rank[severity] < rank[i.last_notified_severity];
    this.incidents.set(incident_id, { ...i, severity, last_seen: this.now(), occurrence_count: i.occurrence_count + 1, recovered_at: null, resolution_run_id: null, last_notified_severity: lowered ? severity : i.last_notified_severity });
  }
  async markRecovered(run_id: string, incident_id: string): Promise<void> {
    this.maybeFail("markRecovered");
    const run = this.run(run_id);
    const i = this.incidents.get(incident_id);
    if (!i || i.state !== "OPEN" || i.source !== run.source || !run.committed || run.status === "FAILED" || !this.evidence(run, i, "PASS")) throw new Error("recovery rejected");
    if (i.recovered_at === null) this.incidents.set(incident_id, { ...i, recovered_at: this.now(), resolution_run_id: run_id });
  }
  async clearRecovery(run_id: string, incident_id: string): Promise<void> {
    const run = this.run(run_id);
    const i = this.incidents.get(incident_id);
    if (!i || i.state !== "OPEN" || i.source !== run.source || !run.committed) throw new Error("clear rejected");
    this.incidents.set(incident_id, { ...i, recovered_at: null, resolution_run_id: null });
  }
  async jobEvent(job_id: string, event: string): Promise<void> { this.jobEvents.push(job_id + ":" + event); }
  async markNotified(run_id: string, incident_id: string, kind: NotificationKind): Promise<void> {
    this.maybeFail("markNotified");
    if (this.refuseMarkFor.has(incident_id)) throw new Error("mark refused");
    const i = this.incidents.get(incident_id);
    if (!i || i.state !== "OPEN") throw new Error("notify rejected");
    this.notified.push({ incident_id, kind });
    if (kind === "RECOVERY") {
      if (i.recovered_at === null) throw new Error("recovery notice without evidence");
      if (!this.evidence(this.run(run_id), i, "PASS")) throw new Error("recovery notice without PASS in the notifying run");
      this.incidents.set(incident_id, { ...i, state: "RESOLVED", resolved_at: this.now() });
    } else {
      this.incidents.set(incident_id, { ...i, last_notified_at: this.now(), last_notified_severity: i.severity });
    }
  }
  async logNotificationFailure(): Promise<void> { this.failuresLogged++; }
  async finishRun(run_id: string, status: "SUCCEEDED" | "FAILED"): Promise<void> {
    this.maybeFail("finishRun:" + status);
    const r = this.run(run_id);
    if (r.status !== "STARTED") throw new Error("run already finished");
    if (status === "SUCCEEDED" && !r.committed) throw new Error("cannot succeed uncommitted");
    r.status = status;
  }
}

export class FakeTransport implements NotificationTransport {
  batches: NotificationBatch[] = [];
  accept = true;
  async send(batch: NotificationBatch): Promise<DeliveryResult> {
    this.batches.push(batch);
    return this.accept ? { accepted: true, code: "accepted" } : { accepted: false, code: "http_503" };
  }
}

let seq = 0;
export function ids(): () => string {
  return () => {
    seq++;
    return "00000000-0000-4000-8000-" + String(seq).padStart(12, "0");
  };
}

export const COOLDOWNS = { WARN: 24 * 3600_000, ERROR: 6 * 3600_000, CRITICAL: 3600_000 };
