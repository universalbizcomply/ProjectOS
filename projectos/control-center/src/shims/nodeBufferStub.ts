/**
 * Browser-build stub for `node:buffer`.
 *
 * `@projectos/core`'s package root re-exports EVERYTHING via `export *` barrels (`src/index.ts`),
 * including `candidateEvidence.ts`, which imports `isUtf8` from `node:buffer` to decide whether a
 * candidate's bytes are text. Nothing in this browser bundle calls that function — no candidate
 * evidence is built client-side — but Rollup still has to BIND every module an `export *` barrel
 * re-exports to resolve what the barrel exposes, so `node:buffer` must resolve to something even
 * though it is dead code here. Vite's own browser externalization produces a shim with no `isUtf8`
 * export, which fails the build at bind time regardless of tree-shaking.
 *
 * This stub satisfies that bind and throws loudly if the dead path is ever actually reached, rather
 * than silently calling text binary. It must never be relied on for a real answer — the Node runtime
 * (agent CLI, sidecar) always uses the real `node:buffer`; only Vite's browser build is aliased to
 * this file, in `vite.config.ts`.
 */
export function isUtf8(): never {
  throw new Error('node:buffer is not available in the browser build; this call path should be unreachable here.');
}
