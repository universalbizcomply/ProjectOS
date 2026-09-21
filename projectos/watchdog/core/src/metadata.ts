// ProjectOS Watchdog Core — typed, allowlisted monitoring metadata (metadata.v1).
//
// Generic monitoring storage never accepts arbitrary diagnostic JSON. Every
// check declares the exact keys it may emit and each key's type. Values are
// numbers, booleans or short machine tokens only: no free text, so no customer
// names, emails, addresses, payment identities, raw provider payloads, stack
// traces, secrets or tokens can enter. The database enforces the same shape
// (watchdog._metadata_is_safe) as a second line.

export type MetadataFieldType = "integer" | "number" | "boolean" | "timestamp" | "uuid" | "code" | "enum";
export type MetadataField = { type: MetadataFieldType; values?: readonly string[] };
export type MetadataSpec = Readonly<Record<string, MetadataField>>;
export type MetadataValue = number | boolean | string;
export type Metadata = Record<string, MetadataValue>;

export const METADATA_MAX_KEYS = 16;
export const METADATA_MAX_STRING = 64;

const KEY = /^[a-z][a-z0-9_]{0,62}$/;
// Mirrors the SQL guard: letters, digits and _ . : + - only. No spaces, no @.
const SAFE_STRING = /^[A-Za-z0-9_.:+-]{1,64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE = /^[A-Z0-9_]{1,64}$/;

export type MetadataCheck = { ok: true; value: Metadata } | { ok: false; errors: string[] };

export function validateMetadataSpec(spec: MetadataSpec): string[] {
  const errors: string[] = [];
  const keys = Object.keys(spec);
  if (keys.length > METADATA_MAX_KEYS) errors.push("spec declares more than " + METADATA_MAX_KEYS + " keys");
  for (const k of keys) {
    if (!KEY.test(k)) errors.push("invalid metadata key name: " + k);
    const f = spec[k];
    if (f.type === "enum") {
      if (!f.values || f.values.length === 0) errors.push("enum key " + k + " has no values");
      else for (const v of f.values) if (!SAFE_STRING.test(v)) errors.push("enum key " + k + " has unsafe value");
    }
  }
  return errors;
}

export function validateMetadata(input: unknown, spec: MetadataSpec): MetadataCheck {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["metadata must be an object"] };
  const errors: string[] = [];
  const out: Metadata = {};
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > METADATA_MAX_KEYS) errors.push("too many metadata keys");
  for (const [k, v] of entries) {
    const f = Object.prototype.hasOwnProperty.call(spec, k) ? spec[k] : undefined;
    if (!f) { errors.push("metadata key not allowlisted: " + k); continue; }
    if (!fieldAccepts(f, v)) { errors.push("metadata key " + k + " rejected for type " + f.type); continue; }
    out[k] = v as MetadataValue;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

function fieldAccepts(f: MetadataField, v: unknown): boolean {
  switch (f.type) {
    case "integer": return typeof v === "number" && Number.isSafeInteger(v);
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "boolean": return typeof v === "boolean";
    case "timestamp": return typeof v === "string" && TIMESTAMP.test(v) && SAFE_STRING.test(v) && Number.isFinite(Date.parse(v));
    case "uuid": return typeof v === "string" && UUID.test(v);
    case "code": return typeof v === "string" && CODE.test(v);
    case "enum": return typeof v === "string" && !!f.values && f.values.includes(v);
    default: return false;
  }
}
