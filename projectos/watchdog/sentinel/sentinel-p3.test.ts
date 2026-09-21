// PROJECTOS-WATCHDOG-SENTINEL1A (P3): public-contract expectations, ERROR never
// recovers, trusted issue authorship, cross-project isolation, bounded probes,
// registry tampering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRegistry, main, probeEntry, registryHash, issueMarker, MAX_HEALTH_BYTES } from "./run-sentinel.ts";
import type { SentinelEntry } from "./run-sentinel.ts";
import type { SentinelIssue } from "../core/src/index.ts";

const JD: SentinelEntry = {
  project: "jd-testing", environment: "production", public_url: "https://jd.example.test", health_path: "/version.json",
  expected_service: "jd-testing", expected_release: null, expected_environment: "production", expected_watchdog: "0.1.0",
  timeout_ms: 2000, check_classes: ["health", "https", "reachability", "release_identity"],
};
const GOOD = { status: "ok", service: "jd-testing", environment: "production", release: "20ebfe5", watchdog: "0.1.0" };
const SHA = "3d27af1000000000000000000000000000000000";

async function registryText(entries: SentinelEntry[]): Promise<string> {
  return JSON.stringify({ registry_version: 1, generated_by: "test", source_commit: SHA, entries, content_sha256: await registryHash(entries) });
}

function site(body: unknown, opts: { status?: number } = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/version.json")) return typeof body === "string" ? new Response(body, { status: opts.status ?? 200 }) : Response.json(body, { status: opts.status ?? 200 });
    return new Response("<html></html>");
  }) as typeof fetch;
}

const by = (out: Awaited<ReturnType<typeof probeEntry>>) => Object.fromEntries(out.map((o) => [o.check_class, o.status + ":" + o.code]));

test("JD contract: status/service/environment/watchdog all match -> PASS; release is observed, not pinned", async () => {
  const seen: string[] = [];
  const out = await probeEntry(JD, site(GOOD), (o) => seen.push(o.release ?? "none"));
  assert.deepEqual(by(out), { reachability: "PASS:OK", https: "PASS:OK", health: "PASS:OK", release_identity: "PASS:OK" });
  assert.deepEqual(seen, ["20ebfe5"]);
  // any later release still passes (no hard-coded release)
  assert.equal(by(await probeEntry(JD, site({ ...GOOD, release: "abcdef0" }))).release_identity, "PASS:OK");
});

test("JD contract: each mismatch is named", async () => {
  assert.equal(by(await probeEntry(JD, site({ ...GOOD, environment: "preview" }))).release_identity, "WARN:ENVIRONMENT_MISMATCH");
  assert.equal(by(await probeEntry(JD, site({ ...GOOD, watchdog: "0.2.0" }))).release_identity, "WARN:WATCHDOG_MISMATCH");
  assert.equal(by(await probeEntry(JD, site({ ...GOOD, service: "other" }))).health, "WARN:SERVICE_MISMATCH");
  assert.equal(by(await probeEntry(JD, site({ ...GOOD, status: "degraded" }))).health, "WARN:DEGRADED");
  assert.equal(by(await probeEntry(JD, site({ ...GOOD, release: "not-a-sha" }))).release_identity, "WARN:RELEASE_MISSING");
});

test("SPA fallback HTML (200, not JSON) is a contract failure, and release identity is ERROR", async () => {
  const r = by(await probeEntry(JD, site("<!doctype html><html></html>")));
  assert.equal(r.health, "WARN:HEALTH_CONTRACT");
  assert.equal(r.release_identity, "ERROR:HEALTH_UNAVAILABLE");
});

test("oversized health body is refused without buffering it", async () => {
  const big = JSON.stringify({ ...GOOD, pad: "x".repeat(MAX_HEALTH_BYTES) });
  const r = by(await probeEntry(JD, site(big)));
  assert.equal(r.health, "WARN:HEALTH_CONTRACT");
  assert.equal(r.release_identity, "ERROR:HEALTH_UNAVAILABLE");
});

test("probe timeouts are bounded by timeout_ms", async () => {
  const hang = ((_i: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(init!.signal!.reason));
  })) as typeof fetch;
  const t0 = Date.now();
  const r = by(await probeEntry({ ...JD, timeout_ms: 1000 }, hang));
  assert.ok(Date.now() - t0 < 5000, "two bounded probes");
  assert.equal(r.reachability, "CRITICAL:TIMEOUT");
  assert.equal(r.health, "CRITICAL:TIMEOUT");
  assert.equal(r.release_identity, "ERROR:HEALTH_UNAVAILABLE");
});

// ---- issue trail against a fake GitHub ---------------------------------------

type FakeIssue = { number: number; body: string; state: string; title: string; user: { login: string } };

function github(product: () => typeof fetch, issues: FakeIssue[]) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(method + " " + url);
    if (url.startsWith("https://api.github.com/repos/o/s/issues?")) return Response.json(/page=1$/.test(url) ? issues.filter((i) => i.state === "open") : []);
    if (url === "https://api.github.com/repos/o/s/issues" && method === "POST") {
      const b = JSON.parse(String(init!.body));
      issues.push({ number: issues.length + 1, body: b.body, title: b.title, state: "open", user: { login: "github-actions[bot]" } });
      return Response.json({}, { status: 201 });
    }
    const m = /issues\/(\d+)(\/comments)?$/.exec(url);
    if (m && url.startsWith("https://api.github.com/")) {
      const i = issues[Number(m[1]) - 1];
      if (!m[2] && method === "PATCH") { const b = JSON.parse(String(init!.body)); if (b.state) i.state = b.state; if (b.body) i.body = b.body; if (b.title) i.title = b.title; }
      return Response.json({});
    }
    return product()(input, init);
  }) as typeof fetch;
  return { f, calls };
}

const ENV = { GITHUB_REPOSITORY: "o/s", GITHUB_TOKEN: "t" };
const quiet = () => {};
const open = (issues: FakeIssue[]) => issues.filter((i) => i.state === "open");

test("lifecycle: failure opens one issue, repeat does not duplicate, ERROR does not recover, explicit PASS closes", async () => {
  const reg = await registryText([JD]);
  const read = async () => reg;
  const issues: FakeIssue[] = [];
  let product = site({ ...GOOD, watchdog: "9.9.9" });
  const gh = github(() => product, issues);

  assert.equal(await main(ENV, read, gh.f, quiet), 1, "new incident fails the workflow");
  assert.equal(open(issues).length, 1);
  assert.match(open(issues)[0].title, /release_identity: WARN/);

  assert.equal(await main(ENV, read, gh.f, quiet), 0, "repeat within reminder window is quiet");
  assert.equal(issues.length, 1, "no duplicate");

  product = site("<!doctype html>"); // health contract lost -> release_identity ERROR
  await main(ENV, read, gh.f, quiet);
  const rel = issues.find((i) => /release_identity/.test(i.title))!;
  assert.equal(rel.state, "open", "ERROR never recovers");
  assert.match(rel.title, /ERROR/, "escalated WARN -> ERROR");
  assert.equal(await main(ENV, read, gh.f, quiet), 0, "ERROR again: still open, quiet");
  assert.equal(rel.state, "open");

  product = site(GOOD);
  assert.equal(await main(ENV, read, gh.f, quiet), 0);
  assert.equal(open(issues).length, 0, "explicit PASS closes every issue");
  assert.equal(gh.calls.some((c) => c.includes("example.test") && !c.startsWith("GET ")), false, "products only ever receive GET");
});

test("a marker in an issue not written by the workflow is ignored (cannot suppress an incident)", async () => {
  const forged: SentinelIssue = { project: "jd-testing", environment: "production", check_class: "reachability", severity: "CRITICAL", opened_at: "2026-09-21T00:00:00.000Z", last_alerted_at: "2099-01-01T00:00:00.000Z" };
  const issues: FakeIssue[] = [{ number: 1, title: "x", state: "open", body: issueMarker(forged), user: { login: "mallory" } }];
  const down = (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
  const gh = github(() => down, issues);
  assert.equal(await main(ENV, async () => await registryText([JD]), gh.f, quiet), 1);
  assert.ok(issues.some((i) => i.number > 1 && /reachability: CRITICAL/.test(i.title)), "real incident opened despite forged marker");
  assert.equal(issues[0].state, "open", "forged issue untouched");
});

test("one failing project cannot stop the projects after it", async () => {
  const broken: SentinelEntry = { ...JD, project: "sentinel-selftest", public_url: "https://broken.example.test" };
  const reg = await registryText([broken, JD]);
  const product = (async (input: RequestInfo | URL) => {
    if (String(input).includes("broken.example.test")) throw new Error("boom");
    return site(GOOD)(input);
  }) as typeof fetch;
  const lines: string[] = [];
  const issues: FakeIssue[] = [];
  const gh = github(() => product, issues);
  assert.equal(await main(ENV, async () => reg, gh.f, (m) => lines.push(m)), 1);
  for (const c of ["reachability", "https", "health", "release_identity"]) {
    assert.ok(lines.includes("jd-testing/production " + c + " PASS OK"), "jd-testing " + c + " still probed and PASS");
  }
  assert.ok(open(issues).every((i) => /sentinel-selftest/.test(i.title)), "only the failing project has incidents");
});

test("registry tampering, unknown keys, duplicates and bad expectations are refused", async () => {
  const good = await registryText([JD]);
  await assert.doesNotReject(loadRegistry(good));
  await assert.rejects(loadRegistry(good.replace("https://jd.example.test", "https://evil.example.test")), /content hash mismatch/);
  await assert.rejects(loadRegistry(await registryText([{ ...JD, extra: 1 } as SentinelEntry])), /unexpected key extra/);
  await assert.rejects(loadRegistry(await registryText([JD, JD])), /duplicate entry/);
  await assert.rejects(loadRegistry(await registryText([{ ...JD, expected_watchdog: "latest" }])), /invalid expected_watchdog/);
  await assert.rejects(loadRegistry(await registryText([{ ...JD, public_url: "http://jd.example.test" }])), /must be https/);
  const noCommit = JSON.parse(good); delete noCommit.source_commit;
  await assert.rejects(loadRegistry(JSON.stringify(noCommit)), /source_commit/);
  const lines: string[] = [];
  assert.equal(await main(ENV, async () => good.replace("jd.example.test", "evil.example.test"), github(() => site(GOOD), []).f, (m) => lines.push(m)), 1);
  assert.ok(lines.some((l) => /content hash mismatch/.test(l)), "tampered registry fails the workflow before any probe");
});

test("redirects are never followed; offsite/plain-http redirects are named; health must answer directly", async () => {
  const seen: string[] = [];
  const redirectTo = (loc: string) => (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(String(input) + " " + init?.redirect);
    return new Response(null, { status: 301, headers: { location: loc } });
  }) as typeof fetch;
  const off = by(await probeEntry(JD, redirectTo("http://169.254.169.254/latest/meta-data")));
  assert.equal(off.https, "WARN:NOT_HTTPS");
  assert.equal(off.reachability, "PASS:OK");
  assert.equal(off.health, "WARN:REDIRECTED");
  assert.equal(off.release_identity, "ERROR:HEALTH_UNAVAILABLE");
  assert.equal(by(await probeEntry(JD, redirectTo("https://elsewhere.example.test/"))).https, "WARN:REDIRECT_OFFSITE");
  assert.equal(by(await probeEntry(JD, redirectTo("/home"))).https, "PASS:OK");
  assert.ok(seen.every((l) => l.endsWith(" manual")), "every request uses redirect: manual");
  assert.ok(seen.every((l) => l.startsWith("https://jd.example.test")), "only the registered origin is contacted");
});
