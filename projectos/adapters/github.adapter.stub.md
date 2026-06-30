# GitHub Adapter — STUB (inert)

**Status:** placeholder only. No code. No API calls. No credentials.

## Intended future interface (later approved phase only)
- `getRepoMetadata(repo)` — read-only repo facts.
- `listOpenPRs(repo)` — read-only.
- `getCommit(repo, sha)` — read-only.

## Hard rules (will apply when built)
- No write operations without an explicit, separately-approved phase.
- No PAT in code or reports; credentials supplied at runtime by the owner only.
- No push / no force push. Subject to `externalServiceGate` and `forcePushProhibition`.