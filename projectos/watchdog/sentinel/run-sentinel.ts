// ProjectOS Watchdog — outer sentinel runner (canonical source, TEMPLATE).
//
// Executes ONLY inside the generated sentinel repository under
// universalbizcomply, on GitHub Actions. Layout there mirrors ProjectOS:
//   core/src/...                 vendored Watchdog Core (pinned by lock)
//   sentinel/run-sentinel.ts     this file
//   sentinel/registry.json       generated registry (reviewed commit)
//   .github/workflows/watchdog-sentinel.yml
//
// It never calls ProjectOS, never needs ProjectOS online, and holds no product
// mutation credential. P3 probes are public and read-only; they write nothing
// into products and cannot advance any product's sentinel liveness.
//
// Flow: verify registry -> probe EVERY product (isolated, sequential) ->
// read open sentinel issues -> plan -> apply issue changes -> exit 1 only
// when something new must be said (new/escalated/reminder) or the sentinel
// itself could not complete (GitHub API or registry failure). Response bodies
// are never logged.

import type { ProbeOutcome, RegistryEntry, SentinelIssue, SentinelCheckClass } from "../core/src/index.ts";
import { planSentinelIssues, registryEntryErrors, runSentinel } from "../core/src/index.ts";

export const ISSUE_LABEL = "watchdog-sentinel";
const MARKER = /<!-- watchdog-sentinel (\{[^\n]*\}) -->/;

type FetchLike = typeof fetch;

function outcome(e: RegistryEntry, cls: SentinelCheckClass, status: ProbeOutcome["status"], code: string): ProbeOutcome {
  return { project: e.project, environment: e.environment, check_class: cls, status, code };
}

async function timed(fetchImpl: FetchLike, url: string, ms: number): Promise<Response | "timeout" | "network"> {
  try {
    return await fetchImpl(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(ms), headers: { "user-agent": "projectos-watchdog-sentinel" } });
  } catch (e) {
    const n = e instanceof Error ? e.name : "";
    return n === "TimeoutError" || n === "AbortError" ? "timeout" : "network";
  }
}

export async function probeEntry(e: RegistryEntry, fetchImpl: FetchLike): Promise<ProbeOutcome[]> {
  const out: ProbeOutcome[] = [];
  const want = new Set(e.check_classes);

  if (want.has("reachability") || want.has("https")) {
    const r = await timed(fetchImpl, e.public_url, e.timeout_ms);
    if (r === "timeout" || r === "network") {
      const code = r === "timeout" ? "TIMEOUT" : "UNREACHABLE";
      if (want.has("reachability")) out.push(outcome(e, "reachability", "CRITICAL", code));
      if (want.has("https")) out.push(outcome(e, "https", "CRITICAL", code));
    } else {
      if (want.has("reachability")) out.push(outcome(e, "reachability", r.status >= 500 ? "CRITICAL" : "PASS", r.status >= 500 ? "HTTP_" + r.status : "OK"));
      if (want.has("https")) {
        const secure = r.url === "" || r.url.startsWith("https://");
        out.push(outcome(e, "https", secure && r.status < 400 ? "PASS" : "WARN", secure ? (r.status < 400 ? "OK" : "HTTP_" + r.status) : "NOT_HTTPS"));
      }
      try { await r.body?.cancel(); } catch (_x) { /* body not needed */ }
    }
  }

  if ((want.has("health") || want.has("release_identity")) && e.health_path) {
    const r = await timed(fetchImpl, new URL(e.health_path, e.public_url).toString(), e.timeout_ms);
    let body: Record<string, unknown> | null = null;
    let failure: ProbeOutcome["status"] | null = null;
    let code = "OK";
    if (r === "timeout" || r === "network") { failure = "CRITICAL"; code = r === "timeout" ? "TIMEOUT" : "UNREACHABLE"; }
    else if (r.status !== 200) { failure = "CRITICAL"; code = "HTTP_" + r.status; try { await r.body?.cancel(); } catch (_x) { /* ignore */ } }
    else {
      try { const j = await r.json(); body = j && typeof j === "object" ? j as Record<string, unknown> : null; } catch (_x) { body = null; }
      if (!body) { failure = "WARN"; code = "HEALTH_CONTRACT"; }
    }
    if (want.has("health")) {
      if (failure) out.push(outcome(e, "health", failure, code));
      else if (e.expected_service !== null && body!.service !== e.expected_service) out.push(outcome(e, "health", "WARN", "SERVICE_MISMATCH"));
      else if (body!.status === "ok") out.push(outcome(e, "health", "PASS", "OK"));
      else if (body!.status === "degraded") out.push(outcome(e, "health", "WARN", "DEGRADED"));
      else out.push(outcome(e, "health", "WARN", "HEALTH_CONTRACT"));
    }
    if (want.has("release_identity")) {
      const rel = body && typeof body.release === "string" ? body.release : null;
      if (failure) out.push(outcome(e, "release_identity", "ERROR", "HEALTH_UNAVAILABLE"));
      else if (!rel || !/^[0-9a-f]{7,40}$/.test(rel)) out.push(outcome(e, "release_identity", "WARN", "RELEASE_MISSING"));
      else if (e.expected_release !== null && !e.expected_release.startsWith(rel) && !rel.startsWith(e.expected_release)) out.push(outcome(e, "release_identity", "WARN", "RELEASE_DRIFT"));
      else out.push(outcome(e, "release_identity", "PASS", "OK"));
    }
  }
  return out;
}

// ---- registry integrity (same canonical hash as the ProjectOS generator) ----

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) o[k] = sortKeys((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}

export async function registryHash(entries: unknown): Promise<string> {
  const text = JSON.stringify(sortKeys(entries), null, 2) + "\n";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loadRegistry(text: string): Promise<RegistryEntry[]> {
  const reg = JSON.parse(text) as { registry_version: number; entries: RegistryEntry[]; content_sha256: string };
  if (reg.registry_version !== 1 || !Array.isArray(reg.entries)) throw new Error("registry: unsupported shape");
  if (await registryHash(reg.entries) !== reg.content_sha256) throw new Error("registry: content hash mismatch");
  for (const e of reg.entries) {
    const errs = registryEntryErrors(e);
    if (errs.length) throw new Error("registry: " + errs.join("; "));
  }
  return reg.entries;
}

// ---- GitHub issue trail ---------------------------------------------------------

export function issueMarker(i: SentinelIssue): string {
  return "<!-- watchdog-sentinel " + JSON.stringify(i) + " -->";
}

export function parseIssue(body: string | null): SentinelIssue | null {
  const m = MARKER.exec(body ?? "");
  if (!m) return null;
  try {
    const x = JSON.parse(m[1]) as SentinelIssue;
    return typeof x.project === "string" && typeof x.check_class === "string" ? x : null;
  } catch (_e) {
    return null;
  }
}

type GitHubIssue = { number: number; body: string | null };

export function gitHubClient(repo: string, token: string, fetchImpl: FetchLike) {
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetchImpl("https://api.github.com/repos/" + repo + path, {
      method,
      headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error("GitHub API " + method + " " + path + " -> " + r.status);
    return r.status === 204 ? null : await r.json();
  };
  return {
    async openIssues(): Promise<Array<{ number: number; issue: SentinelIssue }>> {
      const all: GitHubIssue[] = [];
      for (let page = 1; ; page++) {
        const list = await api("GET", "/issues?state=open&per_page=100&page=" + page + "&labels=" + ISSUE_LABEL) as GitHubIssue[];
        all.push(...list);
        if (list.length < 100) break;
        if (page >= 20) throw new Error("more than 2000 open sentinel issues");
      }
      return all.map((g) => ({ number: g.number, issue: parseIssue(g.body) })).filter((x): x is { number: number; issue: SentinelIssue } => x.issue !== null);
    },
    create: (title: string, body: string) => api("POST", "/issues", { title, body, labels: [ISSUE_LABEL] }),
    comment: (n: number, body: string) => api("POST", "/issues/" + n + "/comments", { body }),
    update: (n: number, patch: Record<string, unknown>) => api("PATCH", "/issues/" + n, patch),
  };
}

const keyOf = (x: { project: string; environment: string; check_class: string }) => x.project + "/" + x.environment + "/" + x.check_class;

export async function main(env: Record<string, string | undefined>, readFile: (p: string) => Promise<string>, fetchImpl: FetchLike, log: (m: string) => void): Promise<number> {
  const repo = env.GITHUB_REPOSITORY, token = env.GITHUB_TOKEN;
  if (!repo || !token) { log("sentinel: GITHUB_REPOSITORY/GITHUB_TOKEN missing"); return 1; }
  const hoursRaw = env.SENTINEL_REMINDER_HOURS === undefined || env.SENTINEL_REMINDER_HOURS === "" ? "6" : env.SENTINEL_REMINDER_HOURS;
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours) || hours <= 0) { log("sentinel: SENTINEL_REMINDER_HOURS must be a positive number"); return 1; }
  const reminderMs = hours * 3600_000;
  let entries: RegistryEntry[];
  try { entries = await loadRegistry(await readFile("sentinel/registry.json")); }
  catch (e) { log("sentinel: " + (e instanceof Error ? e.message : "registry error")); return 1; }

  const outcomes = await runSentinel(entries, (e) => probeEntry(e, fetchImpl), log);
  for (const o of outcomes) log(o.project + "/" + o.environment + " " + o.check_class + " " + o.status + " " + o.code);

  const now = new Date().toISOString();
  try {
    const gh = gitHubClient(repo, token, fetchImpl);
    const open = await gh.openIssues();
    // Duplicates (e.g. a create that timed out but succeeded): the oldest is the
    // tracked issue; the others are closed.
    const byKey = new Map<string, number>();
    const duplicates: number[] = [];
    for (const x of [...open].sort((a, b) => a.number - b.number)) {
      if (byKey.has(keyOf(x.issue))) duplicates.push(x.number); else byKey.set(keyOf(x.issue), x.number);
    }
    const tracked = open.filter((x) => byKey.get(keyOf(x.issue)) === x.number);
    const plan = planSentinelIssues(outcomes, tracked.map((x) => x.issue), now, reminderMs);
    // Each GitHub action is isolated: one failing call never skips the rest.
    let failedActions = 0;
    const attempt = async (what: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { failedActions++; log("sentinel: " + what + " failed: " + (e instanceof Error ? e.message : "error")); }
    };
    for (const n of duplicates) await attempt("close duplicate #" + n, () => gh.update(n, { state: "closed", state_reason: "not_planned" }));
    for (const o of plan.open) {
      const issue: SentinelIssue = { project: o.project, environment: o.environment, check_class: o.check_class, severity: o.status, opened_at: now, last_alerted_at: now };
      await attempt("open " + keyOf(o), () => gh.create("[watchdog] " + o.project + "/" + o.environment + " " + o.check_class + ": " + o.status,
        "Outer sentinel observed **" + o.status + "** (" + o.code + ") at " + now + ".\n\n" + issueMarker(issue)));
    }
    for (const o of plan.escalate) {
      const n = byKey.get(keyOf(o))!;
      const prev = tracked.find((x) => x.number === n)!.issue;
      const issue: SentinelIssue = { ...prev, severity: o.status, last_alerted_at: now };
      await attempt("escalate #" + n, () => gh.comment(n, "Escalated to **" + o.status + "** (" + o.code + ") at " + now + "."));
      await attempt("update #" + n, () => gh.update(n, { title: "[watchdog] " + o.project + "/" + o.environment + " " + o.check_class + ": " + o.status, body: "Outer sentinel incident.\n\n" + issueMarker(issue) }));
    }
    for (const i of plan.remind) {
      const n = byKey.get(keyOf(i))!;
      await attempt("remind #" + n, () => gh.comment(n, "Still failing at " + now + "."));
      await attempt("update #" + n, () => gh.update(n, { body: "Outer sentinel incident.\n\n" + issueMarker({ ...i, last_alerted_at: now }) }));
    }
    for (const i of plan.close) {
      const n = byKey.get(keyOf(i))!;
      await attempt("recover #" + n, () => gh.comment(n, "Recovered: explicit PASS observed at " + now + "."));
      await attempt("close #" + n, () => gh.update(n, { state: "closed", state_reason: "completed" }));
    }
    log("sentinel: opened " + plan.open.length + ", escalated " + plan.escalate.length + ", reminded " + plan.remind.length +
      ", closed " + plan.close.length + ", duplicates " + duplicates.length + ", failed GitHub actions " + failedActions);
    return plan.failWorkflow || failedActions > 0 ? 1 : 0;
  } catch (e) {
    log("sentinel: issue trail failed: " + (e instanceof Error ? e.message : "error"));
    return 1;
  }
}

// Entry point when executed directly by the workflow (Node 24).
if ((import.meta as ImportMeta & { main?: boolean }).main) {
  const fs = await import("node:fs/promises");
  const code = await main(process.env, (p) => fs.readFile(p, "utf8"), fetch, (m) => console.log(m));
  process.exit(code);
}
