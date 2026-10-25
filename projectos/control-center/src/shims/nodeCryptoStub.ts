/**
 * Browser-build stub for `node:crypto`.
 *
 * `@projectos/core`'s package root re-exports EVERYTHING via `export *` barrels (`src/index.ts`),
 * including `gatekeeperDecision.ts`, which imports `createHash` from `node:crypto` to verify a
 * committed decision's digest. Nothing in this browser bundle calls that function — no gatekeeper
 * request/decision verification happens client-side — but Rollup still has to BIND every module an
 * `export *` barrel re-exports to resolve what the barrel exposes, so `node:crypto` must resolve to
 * something even though it is dead code here. Vite's own browser externalization produces a shim
 * with no `createHash` export, which fails the build at bind time regardless of tree-shaking.
 *
 * This stub satisfies that bind and throws loudly if the dead path is ever actually reached, rather
 * than silently producing a wrong hash. It must never be relied on for a real digest — the Node
 * runtime (agent CLI, sidecar) always uses the real `node:crypto`; only Vite's browser build is
 * aliased to this file, in `vite.config.ts`.
 */
export function createHash(): never {
  throw new Error('node:crypto is not available in the browser build; this call path should be unreachable here.');
}
