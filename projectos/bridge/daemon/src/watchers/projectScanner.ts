/**
 * Project scanner — discovers installed projects by locating `.projectops/` directories.
 * No hardcoded project paths: it walks the configured watch roots (each root is either a
 * project itself or a parent containing project subfolders, checked one level deep).
 *
 * Depends only on a small read-only FS subset of DaemonSystem, so it is fully testable.
 */
import { PROJECTOPS_DIR } from '../constants.js';
import type { ProjectDescriptor } from '../types.js';
import { bridgeDir, joinPath, projectopsDir } from '../utils/paths.js';

export interface DirReader {
  exists(path: string): boolean;
  isDir(path: string): boolean;
  readDir(path: string): string[];
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter((s) => s.length > 0);
  return parts.length > 0 ? (parts[parts.length - 1] as string) : path;
}

function describe(fs: DirReader, root: string): ProjectDescriptor {
  return {
    name: basename(root),
    root,
    bridgeDir: bridgeDir(root),
    hasBridge: fs.isDir(bridgeDir(root)),
  };
}

function hasProjectops(fs: DirReader, root: string): boolean {
  return fs.isDir(projectopsDir(root));
}

/**
 * Discover projects across the given roots. A root that itself contains `.projectops` is a
 * project; otherwise its immediate subdirectories are checked. Duplicate roots are collapsed.
 */
export function scanProjects(
  fs: DirReader,
  roots: readonly string[],
  ignored: readonly string[] = [],
): readonly ProjectDescriptor[] {
  const ignoredSet = new Set(ignored);
  const found = new Map<string, ProjectDescriptor>();

  for (const root of roots) {
    if (!fs.isDir(root)) continue;
    if (hasProjectops(fs, root)) {
      const d = describe(fs, root);
      found.set(d.root, d);
      continue;
    }
    for (const entry of fs.readDir(root)) {
      if (ignoredSet.has(entry) || entry === PROJECTOPS_DIR) continue;
      const child = joinPath(root, entry);
      if (fs.isDir(child) && hasProjectops(fs, child)) {
        const d = describe(fs, child);
        found.set(d.root, d);
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
