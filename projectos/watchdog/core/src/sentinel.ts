// ProjectOS Watchdog Core — outer sentinel logic and trust boundary (sentinel-trust.v1).
//
// Two separate concerns:
//
// 1. The GitHub sentinel run (executes in the generated sentinel repo, never
//    calls ProjectOS). Every registered product is probed independently:
//    a failure in product A is recorded and B, C, D are still probed. Only
//    after all probes are the issues planned and the workflow outcome decided.
//    No fail-fast across products.
//
// 2. Sentinel liveness INSIDE a product. An unauthenticated public request must
//    never advance the product's "sentinel last seen" marker, otherwise anyone
//    could mask a dead sentinel. Only a verified, product-scoped sentinel
//    credential (P4+) may advance it, and a product only raises
//    monitoring_sentinel_stale once its profile says probes are authenticated.

import type { CheckStatus } from "./status.ts";
import { isToken } from "./identity.ts";

export const SENTINEL_CHECK_CLASSES = ["reachability", "https", "health", "release_identity"] as const;
export type SentinelCheckClass = typeof SENTINEL_CHECK_CLASSES[number];

export type RegistryEntry = {
  project: string;
  environment: string;
  public_url: string;
  health_path: string | null;
  expected_service: string | null;
  expected_release: string | null;
  timeout_ms: number;
  check_classes: SentinelCheckClass[];
};

export type ProbeOutcome = {
  project: string;
  environment: string;
  check_class: SentinelCheckClass;
  status: CheckStatus;
  code: string;
};

export type Prober = (entry: RegistryEntry) => Promise<ProbeOutcome[]>;

// Sequential, isolated. Never throws because of one product.
export async function runSentinel(entries: readonly RegistryEntry[], probe: Prober, logError: (m: string) => void): Promise<ProbeOutcome[]> {
  const all: ProbeOutcome[] = [];
  for (const entry of entries) {
    let got: ProbeOutcome[];
    try {
      got = await probe(entry);
    } catch (e) {
      logError("[sentinel] probe of " + entry.project + " threw: " + (e instanceof Error ? e.name : "error"));
      got = [];
    }
    // Every declared class gets an outcome; a class the prober did not report
    // is ERROR (could not establish), never an implicit pass.
    for (const cls of entry.check_classes) {
      const hit = got.find((o) => o.check_class === cls && o.project === entry.project && o.environment === entry.environment);
      all.push(hit ?? { project: entry.project, environment: entry.environment, check_class: cls, status: "ERROR", code: "PROBE_NOT_COMPLETED" });
    }
  }
  return all;
}

export type SentinelIssue = {
  project: string;
  environment: string;
  check_class: SentinelCheckClass;
  severity: CheckStatus;
  opened_at: string;
  last_alerted_at: string;
};

export type SentinelPlan = {
  open: ProbeOutcome[];
  escalate: ProbeOutcome[];
  remind: SentinelIssue[];
  close: SentinelIssue[];
  keep: SentinelIssue[];
  failWorkflow: boolean;
};

const RANK: Record<string, number> = { WARN: 1, ERROR: 2, CRITICAL: 3 };

function key(o: { project: string; environment: string; check_class: string }): string {
  return JSON.stringify([o.project, o.environment, o.check_class]);
}

// One deduplicated issue per project/environment/check class. Close only on an
// explicit PASS; ERROR or a missing outcome keeps the issue open. The workflow
// fails (GitHub's native failure notification) only when something new must be
// said: a new issue, an escalation, or a due reminder. Healthy runs and
// unchanged open issues between reminders succeed, so there is no mail storm.
export function planSentinelIssues(outcomes: readonly ProbeOutcome[], open: readonly SentinelIssue[], nowIso: string, reminderMs: number): SentinelPlan {
  if (!Number.isFinite(reminderMs) || reminderMs <= 0) throw new Error("invalid reminder interval");
  const now = Date.parse(nowIso);
  const byKey = new Map(open.map((i) => [key(i), i]));
  const plan: SentinelPlan = { open: [], escalate: [], remind: [], close: [], keep: [], failWorkflow: false };
  const handled = new Set<string>();
  for (const o of outcomes) {
    const k = key(o);
    handled.add(k);
    const issue = byKey.get(k);
    const bad = o.status === "WARN" || o.status === "CRITICAL" || o.status === "ERROR";
    if (!issue) {
      if (bad) plan.open.push(o);
      continue;
    }
    if (o.status === "PASS") { plan.close.push(issue); continue; }
    if (!bad) { plan.keep.push(issue); continue; }
    if ((RANK[o.status] ?? 0) > (RANK[issue.severity] ?? 0)) { plan.escalate.push(o); continue; }
    if (now - Date.parse(issue.last_alerted_at) >= reminderMs) plan.remind.push(issue);
    else plan.keep.push(issue);
  }
  for (const [k, issue] of byKey) if (!handled.has(k)) plan.keep.push(issue);
  plan.failWorkflow = plan.open.length > 0 || plan.escalate.length > 0 || plan.remind.length > 0;
  return plan;
}

export function registryEntryErrors(e: RegistryEntry): string[] {
  const errors: string[] = [];
  if (!isToken(e.project)) errors.push("invalid project");
  if (!isToken(e.environment)) errors.push("invalid environment");
  let url: URL | null = null;
  try { url = new URL(e.public_url); } catch (_x) { errors.push(e.project + ": public_url is not a URL"); }
  if (url) {
    if (url.protocol !== "https:") errors.push(e.project + ": public_url must be https");
    if (url.username || url.password) errors.push(e.project + ": public_url must not carry credentials");
    if (url.search || url.hash) errors.push(e.project + ": public_url must not carry a query or fragment");
  }
  if (e.health_path !== null && !/^\/[A-Za-z0-9_.\/-]{0,127}$/.test(e.health_path)) errors.push(e.project + ": invalid health_path");
  if (e.expected_service !== null && !isToken(e.expected_service)) errors.push(e.project + ": invalid expected_service");
  if (e.expected_release !== null && !/^[0-9a-f]{7,40}$/.test(e.expected_release)) errors.push(e.project + ": invalid expected_release");
  if (!Number.isInteger(e.timeout_ms) || e.timeout_ms < 1000 || e.timeout_ms > 10000) errors.push(e.project + ": timeout_ms must be 1000-10000");
  if (!Array.isArray(e.check_classes) || e.check_classes.length === 0) errors.push(e.project + ": no check classes");
  else for (const c of e.check_classes) if (!(SENTINEL_CHECK_CLASSES as readonly string[]).includes(c)) errors.push(e.project + ": unknown check class " + c);
  if ((e.check_classes || []).includes("health") && e.health_path === null) errors.push(e.project + ": health class needs health_path");
  return errors;
}

// ---- product-side trust boundary ---------------------------------------------

export type SentinelMode = "none" | "public" | "authenticated";

export type ProbeAuth =
  | { kind: "public" }
  | { kind: "sentinel_credential"; verified: boolean };

// The ONLY gate for advancing a product's sentinel liveness marker.
export function mayAdvanceSentinelLiveness(auth: ProbeAuth): boolean {
  return auth.kind === "sentinel_credential" && auth.verified === true;
}

export const SENTINEL_STALE_CHECK_ID = "monitoring_sentinel_stale";

// A product raises sentinel staleness ONLY in authenticated mode. In "public"
// mode (P3) the product cannot tell a real sentinel from any visitor, so it
// makes no claim at all (null), rather than a claim that could be spoofed.
export function sentinelLivenessResult(
  mode: SentinelMode,
  state: { last_authenticated_probe_at: string | null; created_at: string },
  dbNowIso: string,
  staleAfterS: number,
): { check_id: string; status: CheckStatus; reason_code: string | null; metadata: Record<string, number> } | null {
  if (mode !== "authenticated") return null;
  if (!Number.isInteger(staleAfterS) || staleAfterS <= 0) throw new Error("invalid sentinel stale threshold");
  const now = Date.parse(dbNowIso);
  const ref = Date.parse(state.last_authenticated_probe_at ?? state.created_at);
  if (!Number.isFinite(now) || !Number.isFinite(ref)) {
    return { check_id: SENTINEL_STALE_CHECK_ID, status: "ERROR", reason_code: "INVALID_STATE", metadata: {} };
  }
  const age = Math.floor((now - ref) / 1000);
  return age > staleAfterS
    ? { check_id: SENTINEL_STALE_CHECK_ID, status: "CRITICAL", reason_code: "SENTINEL_SILENT", metadata: { age_s: age } }
    : { check_id: SENTINEL_STALE_CHECK_ID, status: "PASS", reason_code: null, metadata: { age_s: age } };
}
