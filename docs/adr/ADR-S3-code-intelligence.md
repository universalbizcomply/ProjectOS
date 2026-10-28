# ADR-S3 — Code-intelligence memory class: SCIP ADAPTER (+ tree-sitter fallback)

**Status:** Decided by the spike, 2026-10-28 (V4 plan Stage 1, spike S3). It is research only.
Nothing was installed, cloned or run. A research subagent drafted it from primary sources and the
lead recorded it. The cited claims were not re-verified one by one, and anything marked UNVERIFIED
is still open. The Windows behaviour of both indexers is **UNVERIFIED**. A live probe phase, which
needs an execution grant, comes before any adoption.

## Question
Which approach gives the Stage 3 context manager symbols, a dependency graph, the relevant tests
and the repository state, **reproducible from a git commit and citing `file:line`**? Determinism and
provenance matter more than recall.

## Options considered

| Approach | TS + Rust | Deterministic | Verdict |
|---|---|---|---|
| SCIP (`scip-typescript` + `rust-analyzer scip`), Apache-2.0 | Both, semantic | Content yes; byte order no | **ADAPTER (primary)** |
| `cargo metadata --frozen --format-version=1` | Rust crate and target graph | Yes | **ADAPTER (with SCIP)** |
| tree-sitter tags, MIT | Both, syntactic | Yes | **ADAPTER (fallback, labelled `syntactic`)** |
| Aider repo-map | Both | Ranking depends on the session | **REFERENCE** (borrow PageRank, without personalisation) |
| universal-ctags | Both | Yes | REJECT (GPL-2.0, weak references) |
| Serena (LSP over MCP) | Both | Live state, no persisted index | REJECT as a memory source (it may stay a worker-side tool) |
| Embeddings / vector search | Any | Probabilistic | REJECT (cannot be cited) |
| Raw TS Compiler API | TS | Yes | REJECT (SCIP wraps it; TS 7 breaks it) |

Sources: [scip](https://github.com/sourcegraph/scip),
[scip.proto](https://raw.githubusercontent.com/sourcegraph/scip/main/scip.proto),
[scip-typescript](https://github.com/sourcegraph/scip-typescript),
[rust-analyzer](https://github.com/rust-lang/rust-analyzer),
[cargo metadata](https://doc.rust-lang.org/cargo/commands/cargo-metadata.html),
[tree-sitter code navigation](https://tree-sitter.github.io/tree-sitter/4-code-navigation.html),
[aider repomap](https://aider.chat/docs/repomap.html), [serena](https://github.com/oraios/serena),
[TS Compiler API wiki](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API).

## Decision and boundary
- **Where it is built:** per commit, in a clean, detached, network-less worktree, after
  `cargo fetch`. Isolation is needed because analysis may run build scripts or proc-macros
  (UNVERIFIED).
- **Normalisation:** strip `project_root`; sort documents, symbols and occurrences; then hash. SCIP
  protobuf field order is not canonical.
- **Cache:** outside the governed tree, keyed by `(tree hash, indexer@version, args)`. Indexer
  versions are pinned and `tool_info` is recorded.
- **Reads:** the context manager only reads the cache. It returns `relative_path:line` citations
  plus the tree hash.
- **Never authority:** gates, approvals and validators never consume the index. A missing or stale
  cache means "no code-intel", never a guess.

## Risks
- **Version mismatch:** scip-typescript 0.5.2 pins TypeScript ^6.0.3, while this repo uses
  TypeScript 5.9.3.
- **Memory:** large TypeScript repos can run out of memory.
- **Validators:** the CommonJS validators need `--infer-tsconfig`.
- **SQLite export:** conversion is experimental, so prefer `scip print --json`.

## Next step
A live probe phase: run both indexers on Windows against two commits, and show that the normalised
output hashes the same twice. This is planned under Stage 3 and needs an execution grant.
