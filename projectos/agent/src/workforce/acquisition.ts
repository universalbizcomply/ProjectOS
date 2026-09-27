/**
 * The ONE-TIME, read-only, governed acquisition of the pinned specialist catalogue.
 *
 * WHO RUNS IT. The owner, in his own terminal (`projectos workforce acquire`). The developer tool's
 * specialist-corpus access guard forbids the assistant session to read, copy or run git in the local
 * corpus, and this acquisition neither disables, weakens nor goes around that guard: it is a ProjectOS
 * command the owner runs outside the assistant session, exactly as the corpus's own update policy
 * already requires of every read of it.
 *
 * WHAT IT DOES. It reads the pinned commit from the source's git metadata (`rev-parse`, a ref read that
 * runs no program), discovers the agents with the same rule the governed tooling used to build the
 * registry (division list from `divisions.json`, every `.md` below a division whose first line is
 * `---` and whose front matter names it), and refuses unless the commit, the agent count and the
 * division count equal the owner's pin and every discovered file equals its registered digest. It
 * copies the agent files, the licence and any notice into a NEW directory under the approved
 * quarantined cache, verifies every copy, marks every file read-only and records the provenance.
 *
 * WHAT IT NEVER DOES. It executes no upstream script and no agent file, runs neither upstream install
 * nor conversion script, installs nothing, touches no developer-tool agent directory, fetches nothing,
 * uses no other commit, activates no specialist and calls no model. It writes nothing outside the new
 * snapshot directory, and it never overwrites an existing snapshot.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { System } from '../system.js';
import { canonicalJson, sha256Hex } from './canonical.js';
import type { InstructionSource } from './dispatch.js';
import { catalogueDigest } from './registry.js';
import type { CataloguePin, RegistryDocument } from './types.js';

export const ACQUISITION_SCHEMA = 'projectos.catalogue-acquisition.v1';
const LICENCE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE'];
const NOTICE_NAMES = ['NOTICE', 'NOTICE.md', 'NOTICE.txt'];
const SAFE_REL = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export interface ScannedAgent {
  readonly id: string;
  readonly division: string;
  readonly name: string;
  readonly path: string;
  readonly digest: string;
  readonly bytes: Buffer;
}

export interface CatalogueScan {
  readonly agents: readonly ScannedAgent[];
  readonly divisions: readonly string[];
  readonly problems: readonly string[];
}

/** The governed tooling's slug rule, so discovered ids equal registered ids. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Front matter by the upstream `is_agent_file` rule the tooling applies: first line `---`. */
export function frontMatter(text: string): Record<string, string> | null {
  const t = text.replace(/\r\n/g, '\n');
  if ((t.split('\n', 1)[0] ?? '').replace(/\r$/, '') !== '---') return null;
  const head = (t.split('\n---', 1)[0] ?? '').slice(3);
  const fields: Record<string, string> = {};
  let key: string | null = null;
  for (const line of head.split('\n')) {
    const m = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
    if (m !== null && m[1] !== undefined) {
      key = m[1];
      fields[key] = (m[2] ?? '').trim();
    } else if (key !== null && (line.startsWith(' ') || line.startsWith('\t'))) fields[key] = `${fields[key] ?? ''} ${line.trim()}`;
  }
  for (const k of Object.keys(fields)) fields[k] = (fields[k] ?? '').replace(/^["']+|["']+$/g, '');
  return fields;
}

/** Discover the agents of a source tree. Reads bytes only; follows no link. */
export function scanCatalogue(source: string): CatalogueScan {
  const problems: string[] = [];
  let divisionIds: string[];
  try {
    const parsed = JSON.parse(readFileSync(join(source, 'divisions.json'), 'utf8')) as { divisions?: Record<string, unknown> };
    divisionIds = Object.keys(parsed.divisions ?? {});
  } catch {
    return { agents: [], divisions: [], problems: ['divisions.json is missing or not JSON'] };
  }
  const agents: ScannedAgent[] = [];
  const walk = (dir: string, rel: string, division: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      const relPath = rel === '' ? name : `${rel}/${name}`;
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        problems.push(`${relPath} is a link; the acquisition follows no link`);
        continue;
      }
      if (st.isDirectory()) walk(full, relPath, division);
      else if (st.isFile() && name.endsWith('.md')) {
        const bytes = readFileSync(full);
        const fields = frontMatter(bytes.toString('utf8'));
        if (fields === null || !fields['name']) continue;
        agents.push({ id: slugify(fields['name']), division, name: fields['name'], path: relPath, digest: sha256Hex(bytes), bytes });
      }
    }
  };
  for (const division of divisionIds) {
    if (!SAFE_REL.test(division)) {
      problems.push(`division '${division}' is not a safe directory name`);
      continue;
    }
    walk(join(source, division), division, division);
  }
  const divisions = [...new Set(agents.map((a) => a.division))].sort();
  return { agents, divisions, problems };
}

export interface AcquisitionProvenance {
  readonly schema: typeof ACQUISITION_SCHEMA;
  readonly sourceRepository: string;
  readonly commit: string;
  readonly catalogueDigest: string;
  readonly licence: { readonly spdx: string; readonly file: string; readonly digest: string };
  readonly notice: { readonly file: string; readonly digest: string } | null;
  readonly importedAt: string;
  readonly divisionCount: number;
  readonly agentCount: number;
  readonly agents: readonly { readonly id: string; readonly division: string; readonly path: string; readonly digest: string }[];
  readonly route: string;
}

export type AcquisitionOutcome =
  | { readonly ok: true; readonly snapshotDir: string; readonly provenance: AcquisitionProvenance }
  | { readonly ok: false; readonly problems: readonly string[] };

export interface AcquisitionInput {
  readonly sys: System;
  readonly source: string;
  readonly cacheRoot: string;
  readonly pin: CataloguePin;
  readonly registry: RegistryDocument;
  readonly now: string;
}

/** The approved cache root from the pin: `<env baseEnv>/<relative>`, or null when it cannot be formed. */
export function approvedCacheRoot(pin: CataloguePin, env: NodeJS.ProcessEnv = process.env): string | null {
  const base = env[pin.cacheLocation.baseEnv];
  if (typeof base !== 'string' || !isAbsolute(base)) return null;
  return join(base, ...pin.cacheLocation.relative.split('/'));
}

function isMit(text: string): boolean {
  return /MIT License/i.test(text) || /Permission is hereby granted, free of charge/i.test(text);
}

export function acquireCatalogue(input: AcquisitionInput): AcquisitionOutcome {
  const { sys, source, cacheRoot, pin, registry } = input;
  const problems: string[] = [];
  if (!isAbsolute(source) || !isAbsolute(cacheRoot)) return { ok: false, problems: ['the source and the cache must be absolute paths'] };
  // THE COMMIT, from git metadata alone. `rev-parse` reads refs; it starts no hook and no filter.
  const head = sys.exec('git', ['-C', source, 'rev-parse', '--verify', 'HEAD^{commit}']);
  const commit = head.stdout.trim();
  if (head.code !== 0) return { ok: false, problems: [`the source is not a readable git checkout (${head.stderr.trim() || `exit ${head.code}`})`] };
  if (commit !== pin.commit) return { ok: false, problems: [`the source is at ${commit.slice(0, 12)}, not the pinned commit ${pin.commit.slice(0, 12)}; no other commit is ever used`] };

  const scan = scanCatalogue(source);
  problems.push(...scan.problems);
  if (scan.agents.length !== pin.expectedAgents) problems.push(`discovered ${scan.agents.length} agents; the owner pinned ${pin.expectedAgents}`);
  if (scan.divisions.length !== pin.expectedDivisions) problems.push(`discovered ${scan.divisions.length} divisions; the owner pinned ${pin.expectedDivisions}`);
  const registered = new Map(registry.entries.map((e) => [e.source.path, e]));
  const seen = new Set<string>();
  for (const a of scan.agents) {
    seen.add(a.path);
    const r = registered.get(a.path);
    if (r === undefined) problems.push(`${a.path} is not registered`);
    else {
      if (r.source.digest !== a.digest) problems.push(`${a.path} differs from its registered digest`);
      if (r.id !== a.id) problems.push(`${a.path} registers as '${r.id}' but names itself '${a.id}'`);
    }
  }
  for (const p of registered.keys()) if (!seen.has(p)) problems.push(`registered ${p} was not found in the source`);
  const licenceName = LICENCE_NAMES.find((n) => existsSync(join(source, n)));
  const licenceBytes = licenceName === undefined ? null : readFileSync(join(source, licenceName));
  if (licenceBytes === null || licenceName === undefined) problems.push('the source carries no licence file');
  else if (pin.licence === 'MIT' && !isMit(licenceBytes.toString('utf8'))) problems.push(`${licenceName} is not the MIT licence the owner pinned`);
  if (problems.length > 0 || licenceBytes === null || licenceName === undefined) return { ok: false, problems };

  const snapshotDir = join(cacheRoot, pin.commit);
  if (existsSync(snapshotDir)) return { ok: false, problems: [`a snapshot already exists at ${snapshotDir}; snapshots are immutable and never overwritten`] };
  const noticeName = NOTICE_NAMES.find((n) => existsSync(join(source, n)));
  const noticeBytes = noticeName === undefined ? null : readFileSync(join(source, noticeName));

  const files: Record<string, string> = {};
  for (const a of scan.agents) files[a.path] = a.digest;
  const provenance: AcquisitionProvenance = {
    schema: ACQUISITION_SCHEMA,
    sourceRepository: pin.upstream,
    commit,
    catalogueDigest: catalogueDigest(files),
    licence: { spdx: pin.licence, file: `licence/${licenceName}`, digest: sha256Hex(licenceBytes) },
    notice: noticeBytes === null || noticeName === undefined ? null : { file: `licence/${noticeName}`, digest: sha256Hex(noticeBytes) },
    importedAt: input.now,
    divisionCount: scan.divisions.length,
    agentCount: scan.agents.length,
    agents: scan.agents.map((a) => ({ id: a.id, division: a.division, path: a.path, digest: a.digest })),
    route: 'owner-run, read-only, governed acquisition at the pinned commit; no upstream code executed',
  };
  if (provenance.catalogueDigest !== registry.catalogue.catalogueDigest) {
    return { ok: false, problems: ['the discovered catalogue digest differs from the registered one'] };
  }

  try {
    return writeSnapshot(cacheRoot, snapshotDir, scan.agents, provenance, licenceBytes, noticeBytes);
  } catch (e) {
    return { ok: false, problems: [`writing the snapshot failed (${(e as Error).message}); nothing was moved into place`] };
  }
}

function writeSnapshot(
  cacheRoot: string,
  snapshotDir: string,
  agents: readonly ScannedAgent[],
  provenance: AcquisitionProvenance,
  licenceBytes: Buffer,
  noticeBytes: Buffer | null,
): AcquisitionOutcome {
  // STAGE, VERIFY, SEAL, THEN MOVE INTO PLACE — a reader never sees half a snapshot.
  const staging = join(cacheRoot, `.incoming-${process.pid}-${Date.now()}`);
  const written: string[] = [];
  const put = (rel: string, bytes: Buffer): void => {
    const target = join(staging, ...rel.split('/'));
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, bytes, { flag: 'wx' });
    written.push(target);
  };
  for (const a of agents) put(`files/${a.path}`, a.bytes);
  put(provenance.licence.file, licenceBytes);
  if (noticeBytes !== null && provenance.notice !== null) put(provenance.notice.file, noticeBytes);
  put('provenance.json', Buffer.from(canonicalJson(provenance), 'utf8'));
  for (const a of agents) {
    if (sha256Hex(readFileSync(join(staging, 'files', ...a.path.split('/')))) !== a.digest) {
      return { ok: false, problems: [`the copy of ${a.path} does not verify; the staging directory ${staging} is left for inspection`] };
    }
  }
  for (const f of written) chmodSync(f, 0o444);
  renameSync(staging, snapshotDir);
  return { ok: true, snapshotDir, provenance };
}

/**
 * Instruction bytes from an acquired snapshot. Dispatch hashes them against the registered digest
 * IMMEDIATELY before use, so a snapshot file changed after acquisition refuses that specialist.
 */
export function cachedInstructionSource(snapshotDir: string): InstructionSource {
  return {
    read(entry) {
      if (!SAFE_REL.test(entry.source.path) || !entry.source.path.endsWith('.md')) return { ok: false, reason: `'${entry.source.path}' is not a safe catalogue path` };
      const full = join(snapshotDir, 'files', ...entry.source.path.split('/'));
      try {
        return { ok: true, bytes: readFileSync(full) };
      } catch {
        return { ok: false, reason: `no acquired instruction text at ${full}; the catalogue has not been acquired` };
      }
    },
  };
}
