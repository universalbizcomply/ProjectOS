/**
 * A scripted `ScratchHost` for the adapter tests that must not touch a disk. PROJECTOS-WORKER-SCRATCH-CHECKOUT1A.
 *
 * It records every call in order (`events`), maps real paths into a fake scratch directory by string, and answers `inspect` and
 * `copyBack` from the script. The real scratch (real directories, real git) is tested in `scratchCheckout.test.ts` and, wired to
 * the adapter, in `codexImplementerScratch.test.ts`.
 */
import type { CopyBackOutcome, OpenOutcome, ScratchCheckout, ScratchHost, ScratchInspection } from '../../src/loop/scratchCheckout.js';

export const FAKE_SCRATCH_ROOT = 'C:/scratch/checkout';

export interface FakeScratchScript {
  readonly realRoot: string;
  readonly openFails?: string;
  readonly placeProblem?: string;
  readonly baselineProblem?: string;
  readonly inspection?: ScratchInspection;
  readonly copy?: CopyBackOutcome;
  readonly disposeProblem?: string;
  /** Runs inside `sys.exec` of the worker, via the test's own codex callback; here for symmetry only. */
  readonly onDispose?: () => void;
  /** Runs when the copy-back is called: a write that LANDS in the real tree together with the copy. */
  readonly onCopyBack?: () => void;
}

export interface FakeScratch {
  readonly host: ScratchHost;
  readonly events: string[];
  /** The text written for each placed path (real path -> text). */
  readonly texts: Record<string, string>;
  readonly placedFiles: string[];
}

export function fakeScratchHost(script: FakeScratchScript): FakeScratch {
  const events: string[] = [];
  const texts: Record<string, string> = {};
  const placedFiles: string[] = [];
  const base = script.realRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const scratchPathOf = (realPath: string): string | null => {
    const p = realPath.replace(/\\/g, '/');
    return p.startsWith(`${base}/`) && !p.slice(base.length + 1).split('/').includes('..') ? `${FAKE_SCRATCH_ROOT}/${p.slice(base.length + 1)}` : null;
  };
  const scratch: ScratchCheckout = {
    root: FAKE_SCRATCH_ROOT,
    skipped: [],
    scratchPathOf,
    placeFile(realPath) {
      events.push('placeFile');
      placedFiles.push(realPath);
      return script.placeProblem ?? null;
    },
    placeText(realPath, text) {
      events.push('placeText');
      texts[realPath] = text;
      return script.placeProblem ?? null;
    },
    baseline() {
      events.push('baseline');
      return script.baselineProblem ?? null;
    },
    inspect() {
      events.push('inspect');
      return script.inspection ?? { kind: 'clean', writes: 0 };
    },
    copyBack() {
      events.push('copyBack');
      script.onCopyBack?.();
      return script.copy ?? { kind: 'copied', paths: [] };
    },
    dispose() {
      events.push('dispose');
      script.onDispose?.();
      return script.disposeProblem ?? null;
    },
  };
  const host: ScratchHost = {
    open(): OpenOutcome {
      events.push('open');
      return script.openFails === undefined ? { ok: true, scratch } : { ok: false, reason: script.openFails };
    },
  };
  return { host, events, texts, placedFiles };
}
