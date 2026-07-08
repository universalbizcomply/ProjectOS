/**
 * Config loader: pure parse + validate of a ProjectOS project-config object.
 *
 * Mirrors the required fields of schemas/project-config.schema.json. This does NOT read
 * from disk — a surface passes in already-parsed JSON (unknown) and gets back a typed,
 * validated config or a list of errors. Keeping it pure makes it testable and reusable
 * by the CLI, dashboard and desktop app alike.
 */
import type { Result } from './types.js';
import { ok, err } from './types.js';

export type InstallStatus = 'not-installed' | 'planned' | 'installed' | 'deferred';

export interface SecretsPolicy {
  readonly allowSecretsInRepo: boolean;
  readonly redactionRequired: boolean;
  readonly notes?: string;
}

export interface ProjectConfig {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectType: string;
  readonly owner: string;
  readonly repo: string;
  readonly localPath: string;
  readonly protectedBranches: readonly string[];
  readonly productionFreeze: boolean;
  readonly allowedActions: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly approvalGates: readonly string[];
  readonly secretsPolicy: SecretsPolicy;
  readonly validators: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly installStatus: InstallStatus;
}

const REQUIRED_STRING_FIELDS: readonly (keyof ProjectConfig)[] = [
  'projectId',
  'projectName',
  'projectType',
  'owner',
  'repo',
  'localPath',
];

const REQUIRED_ARRAY_FIELDS: readonly (keyof ProjectConfig)[] = [
  'protectedBranches',
  'allowedActions',
  'forbiddenActions',
  'approvalGates',
  'validators',
  'evidenceRequirements',
];

const INSTALL_STATUSES: readonly InstallStatus[] = [
  'not-installed',
  'planned',
  'installed',
  'deferred',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Validate raw JSON into a ProjectConfig. Returns all collected errors joined, so the
 * caller sees every problem at once rather than one at a time.
 */
export function parseProjectConfig(raw: unknown): Result<ProjectConfig> {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return err('project-config must be an object');
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof raw[field] !== 'string' || (raw[field] as string).length === 0) {
      errors.push(`missing or empty string field: ${field}`);
    }
  }
  for (const field of REQUIRED_ARRAY_FIELDS) {
    if (!isStringArray(raw[field])) {
      errors.push(`field must be a string array: ${field}`);
    }
  }
  if (typeof raw['productionFreeze'] !== 'boolean') {
    errors.push('productionFreeze must be a boolean');
  }
  if (!INSTALL_STATUSES.includes(raw['installStatus'] as InstallStatus)) {
    errors.push(`installStatus must be one of: ${INSTALL_STATUSES.join(', ')}`);
  }
  if ((raw['forbiddenActions'] as unknown[] | undefined)?.length === 0) {
    errors.push('forbiddenActions must not be empty');
  }
  if ((raw['approvalGates'] as unknown[] | undefined)?.length === 0) {
    errors.push('approvalGates must not be empty');
  }

  const sp = raw['secretsPolicy'];
  if (!isRecord(sp)) {
    errors.push('secretsPolicy must be an object');
  } else {
    if (typeof sp['allowSecretsInRepo'] !== 'boolean') {
      errors.push('secretsPolicy.allowSecretsInRepo must be a boolean');
    }
    if (typeof sp['redactionRequired'] !== 'boolean') {
      errors.push('secretsPolicy.redactionRequired must be a boolean');
    }
  }

  if (errors.length > 0) {
    return err(errors.join('; '));
  }
  return ok(raw as unknown as ProjectConfig);
}
