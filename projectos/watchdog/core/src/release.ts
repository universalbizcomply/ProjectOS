// ProjectOS Watchdog Core — release identity (release-identity.v1).
//
// Internal identity (token-protected / server side):
//   project, environment, release_sha, deployment_id?, deployed_at?,
//   watchdog_core_version, schema_version
// Public representation (safe to serve unauthenticated): service, environment,
// a SHORT release sha and the Watchdog version, plus "ok". Nothing else: no
// deployment ids, timestamps, incident detail, errors or configuration.
// Whether a product may additionally expose a coarse monitor state is a
// per-product security-review decision (exposeMonitorState, default false).

import { isToken } from "./identity.ts";
import { parseSemver } from "./version.ts";

export type ReleaseIdentity = {
  project: string;
  environment: string;
  release_sha: string;
  deployment_id: string | null;
  deployed_at: string | null;
  watchdog_core_version: string;
  schema_version: number;
};

export type PublicHealth = {
  status: "ok" | "degraded";
  service: string;
  environment: string;
  release: string;
  watchdog: string;
};

const SHA = /^[0-9a-f]{7,40}$/;
const DEPLOYMENT_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export function releaseIdentityErrors(r: ReleaseIdentity): string[] {
  const e: string[] = [];
  if (!isToken(r.project)) e.push("invalid project");
  if (!isToken(r.environment)) e.push("invalid environment");
  if (!SHA.test(r.release_sha)) e.push("release_sha must be 7-40 lowercase hex");
  if (r.deployment_id !== null && !DEPLOYMENT_ID.test(r.deployment_id)) e.push("invalid deployment_id");
  if (r.deployed_at !== null && !Number.isFinite(Date.parse(r.deployed_at))) e.push("invalid deployed_at");
  if (!parseSemver(r.watchdog_core_version)) e.push("invalid watchdog_core_version");
  if (!Number.isInteger(r.schema_version) || r.schema_version < 1) e.push("invalid schema_version");
  return e;
}

export function toPublicHealth(
  r: ReleaseIdentity,
  opts: { exposeMonitorState?: boolean; monitorHealthy?: boolean } = {},
): PublicHealth {
  const errors = releaseIdentityErrors(r);
  if (errors.length) throw new Error("invalid release identity: " + errors.join("; "));
  const degraded = opts.exposeMonitorState === true && opts.monitorHealthy === false;
  return {
    status: degraded ? "degraded" : "ok",
    service: r.project,
    environment: r.environment,
    release: r.release_sha.slice(0, 7),
    watchdog: r.watchdog_core_version,
  };
}
