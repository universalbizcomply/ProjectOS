/**
 * A world for the context manager's tests: an in-memory git over a committed tree, an in-memory working tree, memory stores with their
 * provenance, per-project indexes, an admitted run envelope, and the ports that join them. Nothing here touches the real machine
 * except where a test says it opens a real SQLite file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  admitEnvelope,
  joinMemoryEntries,
  memoryEntryHash,
  mintEnvelope,
  parseActionRegistry,
  parseTenantRegistry,
  resolveTenant,
  type ActionRegistry,
  type MemoryEntryProvenance,
  type MemoryStoreState,
  type MemoryTarget,
  type TaskEnvelope,
} from '@projectos/core';
import type { ContextManagerPorts } from '../../src/context/contextPorts.js';
import { blobNameOf } from '../../src/installation/projectAllowlist.js';
import type { DocumentFs, EntryStat, GitRunner } from '../../src/search/ports.js';

export const ROOT = '/work/project';
export const HEAD = 'c'.repeat(40);
export const NOW_ISO = '2026-11-14T10:00:00.000Z';
export const ENVELOPE_NOW = '2026-11-14T10:00:00.000Z';
export const ENVELOPE_LATER = '2026-11-14T11:00:00.000Z';
export const LEDGER_REF = 'docs/changes/delta_spec_V4_PORTS.md';

const security = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../security/${name}`, import.meta.url)), 'utf8'));

export function actionRegistry(): ActionRegistry {
  const parsed = parseActionRegistry(security('action-registry.json'));
  if (!parsed.ok) throw new Error('the committed action registry does not parse');
  return parsed.registry;
}

/** The envelope a real `projectos run --execute` admits, for one of the registered projects. */
export function admittedRun(project: 'polygo' | 'projectos' = 'polygo', expiry = ENVELOPE_LATER): TaskEnvelope {
  const tenants = parseTenantRegistry(security('tenant-registry.json'));
  if (!tenants.ok) throw new Error('the committed tenant registry does not parse');
  const repository = project === 'polygo' ? 'github.com/polygonia-apres/polygo' : 'github.com/universalbizcomply/ProjectOS';
  const root = project === 'polygo' ? 'C:/dev/Polygo/polygo' : 'C:/dev/ProjectOS';
  const resolved = resolveTenant(tenants.registry, { projectId: project, repository, root, worktrees: null });
  if (!resolved.ok) throw new Error(resolved.reasons.join('; '));
  const minted = mintEnvelope(
    { binding: resolved.binding, registry: actionRegistry(), principal: 'implementer', actor: { agent: 'claude-code-cli', provider: 'anthropic', model: 'm' }, envelopeId: `ENV-${project === 'polygo' ? '1' : '2'.repeat(1)}${'1'.repeat(23)}` },
    { action: 'run-start', subjectHash: HEAD, scope: [`project:${project}`], budget: 0, expiry, intentScope: 'governed-run' },
  );
  const admission = admitEnvelope(minted, ENVELOPE_NOW, () => true, () => true);
  if (!admission.admitted) throw new Error('the run was not admitted');
  return admission.envelope;
}

export interface CommittedFile {
  readonly text: string;
  readonly mode?: string;
  readonly type?: string;
}

/** A git over an in-memory committed tree. It records every call. */
export function fakeGit(tree: Readonly<Record<string, CommittedFile>>, head: string | null = HEAD) {
  const calls: string[] = [];
  const objects = new Map<string, string>();
  const entryOf = (path: string) => {
    const held = tree[path];
    if (held === undefined) return null;
    const object = blobNameOf(held.text, 'x'.repeat(40));
    objects.set(object, held.text);
    return { mode: held.mode ?? '100644', type: held.type ?? 'blob', object };
  };
  const git: GitRunner = (args) => {
    calls.push(args.join(' '));
    const [verb, ...rest] = args;
    if (verb === 'rev-parse') return head === null ? { code: 128, stdout: '' } : { code: 0, stdout: `${head}\n` };
    if (verb === 'ls-tree' && rest[0] === '-z' && rest[1] !== '-r') {
      const path = rest[rest.length - 1] ?? '';
      const entry = entryOf(path);
      return { code: 0, stdout: entry === null ? '' : `${entry.mode} ${entry.type} ${entry.object}\t${path}\0` };
    }
    if (verb === 'cat-file' && rest[0] === '-s') return objects.has(rest[1] ?? '') ? { code: 0, stdout: `${new TextEncoder().encode(objects.get(rest[1] ?? '') ?? '').length}\n` } : { code: 128, stdout: '' };
    if (verb === 'cat-file' && rest[0] === 'blob') {
      const text = objects.get(rest[1] ?? '');
      return text === undefined ? { code: 128, stdout: '' } : { code: 0, stdout: text };
    }
    return { code: 1, stdout: '' };
  };
  return { git, calls };
}

/** An in-memory working tree: files by absolute path, every parent directory implied. */
export function memoryFs(files: Record<string, string>): DocumentFs {
  const directories = new Set<string>();
  for (const path of Object.keys(files)) {
    const parts = path.split('/');
    for (let length = 1; length < parts.length; length += 1) directories.add(parts.slice(0, length).join('/'));
  }
  const stat = (path: string): EntryStat | null => {
    if (path in files) return { kind: 'file', size: new TextEncoder().encode(files[path] ?? '').length, mtimeMs: 1 };
    return directories.has(path) ? { kind: 'directory', size: 0, mtimeMs: 1 } : null;
  };
  return {
    stat,
    readText: (path) => files[path] ?? null,
    listDir: (path) => {
      const prefix = `${path}/`;
      const names = [...Object.keys(files), ...directories].filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length).split('/')[0] ?? '');
      return [...new Set(names)].filter((name) => name !== '');
    },
  };
}

/** Files committed AND present in the working tree, the same bytes. */
export function committedWorld(tree: Readonly<Record<string, string>>, head: string | null = HEAD) {
  const committed = Object.fromEntries(Object.entries(tree).map(([path, text]) => [path, { text }]));
  const { git, calls } = fakeGit(committed, head);
  const fs = memoryFs(Object.fromEntries(Object.entries(tree).map(([path, text]) => [`${ROOT}/${path}`, text])));
  return { git, fs, calls };
}

const APPROVED_AT = '2026-11-01T10:00:00Z';

export function provenanceOf(entry: string, kind: MemoryEntryProvenance['kind'] = 'fact'): MemoryEntryProvenance {
  return {
    entryHash: memoryEntryHash(entry),
    kind,
    author: 'owner',
    authorRole: 'owner',
    session: 'sess-0',
    proposedAt: APPROVED_AT,
    proposalId: 'mem-000000000000000000000000',
    proposalHash: `sha256:${'0'.repeat(64)}`,
    approvedBy: 'owner',
    approvedAt: APPROVED_AT,
    ledgerRef: kind === 'decision' ? LEDGER_REF : null,
  };
}

/** A memory store as the loader reads it: the entries and the whole records the owner approved. */
export function storeOf(entries: readonly { readonly text: string; readonly kind?: MemoryEntryProvenance['kind'] | null }[]): MemoryStoreState {
  return {
    entries: entries.map((entry) => entry.text),
    provenance: new Map(entries.filter((entry) => entry.kind !== null).map((entry) => [memoryEntryHash(entry.text), provenanceOf(entry.text, entry.kind ?? 'fact')])),
  };
}

export const MEMORY_FILE = '.projectops/memory/MEMORY.md';
export const USER_FILE = '.projectops/memory/USER.md';

/** The text a store file holds for these entries. */
export const storeText = (entries: readonly string[]): string => joinMemoryEntries(entries);

export interface WorldOptions {
  readonly tree?: Readonly<Record<string, string>>;
  readonly head?: string | null;
  readonly stores?: Partial<Record<MemoryTarget, MemoryStoreState>>;
  readonly openIndex?: ContextManagerPorts['openIndex'];
  readonly secretScreen?: ContextManagerPorts['secretScreen'];
  readonly isProxy?: ContextManagerPorts['isProxy'];
  readonly registry?: ActionRegistry | null;
  readonly drafter?: ContextManagerPorts['drafter'];
  readonly checkout?: ContextManagerPorts['checkout'];
  /** How many names a file has; every file has one unless a test says otherwise. */
  readonly linkCount?: ContextManagerPorts['linkCount'];
}

export function worldPorts(options: WorldOptions = {}) {
  const world = committedWorld(options.tree ?? {}, options.head === undefined ? HEAD : options.head);
  const ports: ContextManagerPorts = {
    git: world.git,
    fs: world.fs,
    clock: { nowMs: () => Date.parse(NOW_ISO) },
    secretScreen: options.secretScreen ?? (() => false),
    isProxy: options.isProxy ?? (() => false),
    readMemoryStore: (target) => ({ ok: true, value: options.stores?.[target] ?? { entries: [], provenance: new Map() } }),
    openIndex: options.openIndex ?? null,
    registry: options.registry === undefined ? null : options.registry,
    linkCount: options.linkCount ?? (() => 1),
    checkout: options.checkout ?? (() => ({ tenant: admittedRun().tenant, project: admittedRun().project })),
    ...(options.drafter === undefined ? {} : { drafter: options.drafter }),
  };
  return { ports, calls: world.calls };
}
