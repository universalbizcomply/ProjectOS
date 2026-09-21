// ProjectOS Watchdog Core — version and compatibility contract.
//
// The core version and the schema version are independent. A core release
// declares the ONE schema version it requires; a core release that does not
// change the database keeps the same REQUIRED_SCHEMA_VERSION. A ProjectOS
// release never implies a Watchdog release.

export const WATCHDOG_CORE_VERSION = "0.1.0";
export const REQUIRED_SCHEMA_VERSION = 1;

// Contracts this core implements. The conformance validator checks that a
// product's vendored copy declares every contract it relies on.
export const CORE_CONTRACTS = [
  "status.v1",
  "run.v1",
  "incident-identity.v1",
  "incident-ownership.v1",
  "positive-recovery.v1",
  "notification-truth.v1",
  "metadata.v1",
  "job-health.v1",
  "release-identity.v1",
  "sentinel-trust.v1",
] as const;

export type SchemaCompatibility =
  | { ok: true; installed: number; required: number }
  | { ok: false; reason: "schema_missing" | "schema_too_old" | "schema_too_new"; installed: number | null; required: number };

// v0.1.0 accepts exactly its required schema. An older schema means the
// product migration was not applied; a newer one means the runtime is older
// than the database. Both must refuse truthfully rather than run.
export function checkSchemaCompatibility(installed: unknown): SchemaCompatibility {
  const required = REQUIRED_SCHEMA_VERSION;
  if (typeof installed !== "number" || !Number.isInteger(installed) || installed < 1) {
    return { ok: false, reason: "schema_missing", installed: null, required };
  }
  if (installed < required) return { ok: false, reason: "schema_too_old", installed, required };
  if (installed > required) return { ok: false, reason: "schema_too_new", installed, required };
  return { ok: true, installed, required };
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(v: unknown): [number, number, number] | null {
  if (typeof v !== "string") return null;
  const m = SEMVER.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Core-to-core compatibility (e.g. a runtime reading state written by another
// installed core). Pre-1.0 a minor bump is breaking, so major AND minor must
// match; from 1.0 only the major must match.
export function isCoreCompatible(other: unknown, current: string = WATCHDOG_CORE_VERSION): boolean {
  const a = parseSemver(other);
  const b = parseSemver(current);
  if (!a || !b) return false;
  if (b[0] === 0) return a[0] === 0 && a[1] === b[1];
  return a[0] === b[0];
}
