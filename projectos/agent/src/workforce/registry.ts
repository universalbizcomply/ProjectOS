/**
 * The agent registry: every agent of the pinned catalogue, registered with restrictive defaults.
 *
 * WHAT A REGISTRY ENTRY MAY CARRY. Only what is derived from the source (identity, name, division,
 * specialties, source path and digest, and what the text declares about itself) plus the MOST
 * RESTRICTIVE default for everything else. Grants come from ProjectOS configuration
 * (`workforce-config.json` `roles`), and eligibility from evaluation — never from the imported text.
 * `validateRegistryDocument` refuses a registry whose entries carry anything wider, so a registry edit
 * cannot hand a role a tool.
 *
 * COUNT EQUALITY. The owner fixed the expected commit, agent count and division count in the
 * workforce configuration, independently of any scan. The registry must match all three, and every
 * agent must be registered — including the ones whose eligibility is restricted.
 */
import { sha256Hex, SHA256_HEX } from './canonical.js';
import type {
  CataloguePin,
  CostClass,
  EligibilityStatus,
  RegistryDocument,
  RegistryEntry,
  RiskTier,
  TaskType,
  ToolName,
  WorkforceConfig,
} from './types.js';

export const RESULT_SCHEMA_ID = 'projectos.specialist-result.v1';
const ELIGIBILITY: readonly EligibilityStatus[] = ['ineligible', 'restricted', 'fixture-eligible'];
const ROLE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const emptyArray = (v: unknown): boolean => Array.isArray(v) && v.length === 0;

/** The catalogue digest: SHA-256 over `path<TAB>digest<LF>` lines sorted by path. */
export function catalogueDigest(files: Readonly<Record<string, string>>): string {
  const lines = Object.keys(files)
    .sort()
    .map((p) => `${p}\t${files[p]}\n`)
    .join('');
  return sha256Hex(lines);
}

export function registryFiles(entries: readonly RegistryEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) out[e.source.path] = e.source.digest;
  return out;
}

/** Schema check of ONE entry, including every restrictive default. The first eligibility check. */
export function validateRegistryEntry(v: unknown): string[] {
  if (!isObj(v)) return ['registry entry is not an object'];
  const id = String(v['id']);
  const p = `registry entry '${id}'`;
  const e: string[] = [];
  if (!ROLE_ID.test(id)) e.push(`${p}: id is not a role id`);
  if (typeof v['name'] !== 'string' || v['name'].length === 0) e.push(`${p}: name is missing`);
  if (v['version'] !== 1) e.push(`${p}: version must be 1`);
  const src = v['source'];
  if (!isObj(src) || typeof src['repository'] !== 'string' || typeof src['commit'] !== 'string' || typeof src['path'] !== 'string' || !SHA256_HEX.test(String(src['digest']))) {
    e.push(`${p}: source must carry repository, commit, path and a sha256 digest`);
  }
  if (typeof v['division'] !== 'string' || v['division'].length === 0) e.push(`${p}: division is missing`);
  else if (isObj(src) && !String(src['path']).startsWith(`${v['division']}/`)) e.push(`${p}: source path is not under its division`);
  if (!Array.isArray(v['specialties'])) e.push(`${p}: specialties must be an array`);
  if (!Array.isArray(v['sourceDeclares'])) e.push(`${p}: sourceDeclares must be an array`);
  // THE RESTRICTIVE DEFAULTS. Nothing here is derived from the source, so nothing here may be wider.
  for (const k of ['applicablePhaseTypes', 'capabilities', 'requiredInputs', 'evidenceRequirements']) {
    if (!emptyArray(v[k])) e.push(`${p}: ${k} must be empty in the registry (ProjectOS configuration supplies it)`);
  }
  const tools = v['tools'];
  if (!isObj(tools) || !emptyArray(tools['allowed']) || !Array.isArray(tools['forbidden']) || (tools['forbidden'] as unknown[])[0] !== '*') {
    e.push(`${p}: tools must be {allowed: [], forbidden: ["*"]}`);
  }
  const scopes = v['scopes'];
  if (!isObj(scopes) || !emptyArray(scopes['read']) || !emptyArray(scopes['write'])) e.push(`${p}: scopes must be empty`);
  if (v['outputSchema'] !== RESULT_SCHEMA_ID) e.push(`${p}: outputSchema must be ${RESULT_SCHEMA_ID}`);
  if (v['costClass'] !== 'high') e.push(`${p}: costClass default must be the most restrictive ("high")`);
  const mp = v['modelPreferences'];
  if (!isObj(mp) || mp['primary'] !== null || !emptyArray(mp['fallbacks'])) e.push(`${p}: modelPreferences must default to none`);
  if (v['parallelSafe'] !== false) e.push(`${p}: parallelSafe must default to false`);
  const roles = v['roles'];
  if (!isObj(roles) || roles['implementation'] !== false || roles['review'] !== false) e.push(`${p}: roles must default to none`);
  if (v['protectedActionPolicy'] !== 'refuse-all') e.push(`${p}: protectedActionPolicy must be refuse-all`);
  if (v['riskTier'] !== 'high') e.push(`${p}: riskTier default must be the most restrictive ("high")`);
  const el = v['eligibility'];
  if (!isObj(el) || !ELIGIBILITY.includes(el['status'] as EligibilityStatus) || !Array.isArray(el['models']) || typeof el['basis'] !== 'string') {
    e.push(`${p}: eligibility must be {status, models, basis}`);
  } else if (el['status'] === 'fixture-eligible' ? (el['models'] as unknown[]).length === 0 : (el['models'] as unknown[]).length !== 0) {
    e.push(`${p}: only a fixture-eligible entry names evaluated models`);
  }
  return e;
}

/** Validate the whole registry against the owner's independent pin. */
export function validateRegistryDocument(v: unknown, pin: CataloguePin): string[] {
  if (!isObj(v)) return ['registry is not an object'];
  const e: string[] = [];
  if (v['schemaVersion'] !== 1) e.push('registry schemaVersion must be 1');
  const entries = v['entries'];
  if (!Array.isArray(entries)) return [...e, 'registry entries is missing'];
  for (const entry of entries) e.push(...validateRegistryEntry(entry));
  if (e.length > 0) return e;
  const doc = v as unknown as RegistryDocument;
  const cat = doc.catalogue;
  if (!isObj(cat)) return ['registry catalogue provenance is missing'];
  if (cat.repository !== pin.upstream) e.push('registry catalogue repository differs from the pinned upstream');
  if (cat.commit !== pin.commit) e.push(`registry catalogue commit ${String(cat.commit).slice(0, 12)} is not the pinned commit`);
  if (cat.licence?.spdx !== pin.licence) e.push('registry licence differs from the pinned licence');
  if (typeof cat.licence?.notice !== 'string' || cat.licence.notice.length === 0) e.push('registry licence notice is missing');
  const ids = new Set<string>();
  const paths = new Set<string>();
  const divisions = new Set<string>();
  for (const entry of doc.entries) {
    if (ids.has(entry.id)) e.push(`registry registers '${entry.id}' twice`);
    if (paths.has(entry.source.path)) e.push(`registry registers source path '${entry.source.path}' twice`);
    ids.add(entry.id);
    paths.add(entry.source.path);
    divisions.add(entry.division);
    if (entry.source.commit !== pin.commit) e.push(`registry entry '${entry.id}' names another commit`);
    if (entry.source.repository !== pin.upstream) e.push(`registry entry '${entry.id}' names another repository`);
  }
  if (doc.entries.length !== pin.expectedAgents) e.push(`registry holds ${doc.entries.length} agents; the owner pinned ${pin.expectedAgents}`);
  if (cat.agentCount !== pin.expectedAgents) e.push('registry agentCount differs from the pin');
  if (divisions.size !== pin.expectedDivisions) e.push(`registry spans ${divisions.size} divisions; the owner pinned ${pin.expectedDivisions}`);
  if (cat.divisionCount !== pin.expectedDivisions) e.push('registry divisionCount differs from the pin');
  if (cat.catalogueDigest !== catalogueDigest(registryFiles(doc.entries))) e.push('registry catalogueDigest does not match its entries');
  return e;
}

/** A role as ProjectOS will actually treat it: the registry entry, overlaid by ProjectOS configuration. */
export interface EffectiveRole {
  readonly id: string;
  readonly version: number;
  readonly entry: RegistryEntry;
  readonly configured: boolean;
  readonly capabilities: readonly string[];
  readonly applicablePhaseTypes: readonly TaskType[];
  readonly tools: readonly ToolName[];
  readonly readScopes: readonly string[];
  readonly writeScopes: readonly string[];
  readonly requiredInputs: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly costClass: CostClass;
  readonly modelPreference: string | null;
  readonly parallelSafe: boolean;
  readonly implementation: boolean;
  readonly review: boolean;
  readonly riskTier: RiskTier;
}

/**
 * The effective role. THE IMPORTED TEXT IS NOT AN INPUT: this function cannot see it, so nothing an
 * instruction says can change what it returns. `sourceDeclares` is carried on the entry for reporting
 * and is never read here.
 */
export function effectiveRole(entry: RegistryEntry, config: WorkforceConfig): EffectiveRole {
  const c = Object.prototype.hasOwnProperty.call(config.roles, entry.id) ? config.roles[entry.id] : undefined;
  if (c === undefined) {
    return {
      id: entry.id,
      version: entry.version,
      entry,
      configured: false,
      capabilities: [],
      applicablePhaseTypes: [],
      tools: [],
      readScopes: [],
      writeScopes: [],
      requiredInputs: [],
      evidenceRequirements: [],
      costClass: entry.costClass,
      modelPreference: null,
      parallelSafe: false,
      implementation: false,
      review: false,
      riskTier: entry.riskTier,
    };
  }
  return {
    id: entry.id,
    version: entry.version,
    entry,
    configured: true,
    capabilities: c.capabilities,
    applicablePhaseTypes: c.applicablePhaseTypes,
    tools: c.tools,
    readScopes: c.readScopes,
    writeScopes: c.writeScopes,
    requiredInputs: c.requiredInputs,
    evidenceRequirements: c.evidenceRequirements,
    costClass: c.costClass,
    modelPreference: c.modelPreference,
    parallelSafe: c.parallelSafe,
    implementation: c.implementation,
    review: c.review,
    riskTier: c.riskTier,
  };
}

export function findEntry(registry: RegistryDocument, id: string): RegistryEntry | undefined {
  return registry.entries.find((e) => e.id === id);
}

/** Is this role eligible to run on this model? Fixture eligibility holds only for its evaluated models. */
export function isEligibleFor(entry: RegistryEntry, modelRef: string): boolean {
  return entry.eligibility.status === 'fixture-eligible' && entry.eligibility.models.includes(modelRef);
}

export interface CatalogueChange {
  readonly fromCommit: string;
  readonly toCommit: string;
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
  readonly unchanged: number;
  /** Always false: in this phase ProjectOS only DETECTS and REPORTS a new commit. */
  readonly reachesRegistry: false;
  readonly requiredBeforeImport: readonly string[];
}

export const IMPORT_STEPS = ['discovery', 'difference', 'security check', 'contract check', 'evaluation', 'owner-approved import'] as const;

/** Compare a candidate commit's catalogue with the pinned one. Detection only — nothing is imported. */
export function detectCatalogueChange(
  pinned: { readonly commit: string; readonly files: Readonly<Record<string, string>> },
  candidate: { readonly commit: string; readonly files: Readonly<Record<string, string>> },
): CatalogueChange {
  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  for (const [path, digest] of Object.entries(candidate.files)) {
    const before = pinned.files[path];
    if (before === undefined) added.push(path);
    else if (before !== digest) changed.push(path);
    else unchanged += 1;
  }
  const removed = Object.keys(pinned.files).filter((p) => candidate.files[p] === undefined);
  return {
    fromCommit: pinned.commit,
    toCommit: candidate.commit,
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort(),
    unchanged,
    reachesRegistry: false,
    requiredBeforeImport: IMPORT_STEPS,
  };
}
