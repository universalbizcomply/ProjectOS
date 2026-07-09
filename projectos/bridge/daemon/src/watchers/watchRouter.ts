/**
 * Watch router — pure. Classifies a changed filesystem path into a domain ChangeKind and
 * attributes it to the owning project. Downstream watchers dispatch on the kind. No I/O.
 */
import type { ChangeKind, FileChange, ProjectDescriptor } from '../types.js';

function normalize(path: string): string {
  return path.replace(/\\/g, '/');
}

/** Classify a normalized path (relative to a project) into a ChangeKind. */
export function kindForPath(path: string): ChangeKind {
  const p = normalize(path);
  if (p.includes('/.git/') || p.endsWith('/.git')) return 'git';
  if (p.includes('/.projectops/bridge/prompts')) return 'prompt';
  if (p.includes('/.projectops/bridge/reports')) return 'report';
  if (p.includes('/.projectops/bridge/evidence')) return 'evidence';
  if (p.includes('/.projectops/bridge/events')) return 'event';
  if (p.includes('/.projectops/bridge/state')) return 'state';
  if (p.includes('/.projectops/bridge/approvals')) return 'approval';
  if (p.includes('/.projectops/workers')) return 'worker';
  if (p.includes('/.projectops/phases')) return 'phase';
  return 'unknown';
}

/**
 * Attribute a path to a project (longest matching root wins) and classify it. Returns null
 * when the path belongs to no known project or classifies as unknown.
 */
export function classifyChange(
  path: string,
  projects: readonly ProjectDescriptor[],
): FileChange | null {
  const p = normalize(path);
  let best: ProjectDescriptor | undefined;
  for (const proj of projects) {
    const root = normalize(proj.root);
    if ((p === root || p.startsWith(root + '/')) && (best === undefined || root.length > normalize(best.root).length)) {
      best = proj;
    }
  }
  if (best === undefined) return null;
  const kind = kindForPath(p);
  if (kind === 'unknown') return null;
  return { project: best.name, path: p, kind };
}
