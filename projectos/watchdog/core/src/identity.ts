// ProjectOS Watchdog Core — incident identity (incident-identity.v1).
//
// identity = project + environment + source + check_id + scope_type + scope_id
//
// One active incident per exact identity. Site A never suppresses Site B and
// component A never resolves component B, because the scope is part of the
// identity rather than a detail inside a shared row.

export type IncidentIdentity = {
  project: string;
  environment: string;
  source: string;
  check_id: string;
  scope_type: string;
  scope_id: string;
};

export const GLOBAL_SCOPE = { scope_type: "global", scope_id: "global" } as const;

const TOKEN = /^[a-z0-9][a-z0-9_.:-]{0,79}$/;
const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export function isToken(v: unknown): v is string {
  return typeof v === "string" && TOKEN.test(v);
}

export function isScopeId(v: unknown): v is string {
  return typeof v === "string" && SCOPE_ID.test(v);
}

export function identityErrors(i: Partial<IncidentIdentity>): string[] {
  const errors: string[] = [];
  for (const k of ["project", "environment", "source", "check_id", "scope_type"] as const) {
    if (!isToken(i[k])) errors.push("invalid identity field " + k);
  }
  if (!isScopeId(i.scope_id)) errors.push("invalid identity field scope_id");
  return errors;
}

export function identityKey(i: IncidentIdentity): string {
  return JSON.stringify([i.project, i.environment, i.source, i.check_id, i.scope_type, i.scope_id]);
}

export function sameIdentity(a: IncidentIdentity, b: IncidentIdentity): boolean {
  return identityKey(a) === identityKey(b);
}
