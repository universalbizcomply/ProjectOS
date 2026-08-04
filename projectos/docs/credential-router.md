# Multi-project credential and MCP isolation router

The problem this solves: one machine, six concurrent sessions (ProjectOS, BizComply V2, two JD Testing,
two PolyGo). GitHub, Supabase, Vercel and MCP state is machine-global by default, so a session picks up
whichever account was last selected, and `gh auth switch` in one terminal silently retargets every other.
This capability makes provider identity **per session** instead of per machine.

## The four layers

| Layer | Module | Answers |
|---|---|---|
| L1 connection profile | `.projectops/connections.json` + `session-router/project-registry.cjs` | which project is this checkout, and which provider identities does it pin? |
| L2 vault | `credentials/vault.cjs` over `credentials/windows-credential-store.*` | where does the secret live, and who may have it? |
| L3 session router | `session-router/router.cjs` | what does this one child process get to see? |
| L4 operation gate | `credentials/operation-gate.cjs` | how does a high-risk credential run exactly one command? |

## The trust anchor (read this first)

`.projectops/connections.json` lives **inside** the checkout it describes. On its own it proves nothing:
any directory can `git init`, point `origin` at a public repository, and declare `projectId: "polygo"`.

So the connection profile is only ever half of the comparison. The other half is the **owner project
registry** — `%LOCALAPPDATA%\ProjectOS\projects.json`, written only by `projectos projects register
--owner-confirm`. It pins, per project: the canonical checkout roots that may claim the id, the GitHub
repository, the Supabase project ref per environment, and the Vercel organisation and project id per
environment. A session is admitted only when the in-checkout profile agrees with the registry on every
pinned fact, and a project with no registry entry cannot start a session at all.

```
projectos projects register --checkout C:\dev\Polygo --owner-confirm
projectos projects register --checkout C:\dev\Polygo-worktrees\feature-x --owner-confirm   # second worktree
projectos projects list
```

## Credential references

```
ProjectOS/<project>/<environment>/<provider>/<credential>
```

A reference names a secret; it is not one. References are the only credential-related text that may appear
in a repository, a `.projectops` file, a `.mcp.json`, a log, a report or a prompt.

Every credential is one of two risk classes, and classification is **fail-closed** — an unknown credential
name is treated as the higher-risk one:

- `session` — `gh-token`, `supabase-access-token`, `vercel-token`. May be projected into a session's child
  environment.
- `operation` — everything else, including `db-password`, `service-role-key`, `production-deploy-token`,
  `real-send-credential`, `payment-credential`. Never enters a session; released for one owner-gated
  command through L4.

## Storing a credential

```
projectos credentials set    --ref ProjectOS/polygo/staging/github/gh-token
projectos credentials status --project polygo
projectos credentials doctor --project polygo
projectos credentials delete --ref ProjectOS/polygo/staging/github/gh-token
```

The value is typed at a hidden prompt on an interactive terminal. There is **no flag that accepts a
value** — `--value`, `--secret`, `--password`, `--token` and `--key` are refused by name — and piped stdin
is refused, because a piped value came from something that already recorded it. Storage is the Windows
Credential Manager, reached through `windows-credential-store.ps1`, which takes the value only on the
`PROJECTOS_CREDENTIAL_VALUE` environment channel and never as a command argument.

Everything ProjectOS may *know* about a credential without holding it — first provisioned, last rotated,
expiry, a short non-reversible fingerprint — lives in `credential-metadata.json` beside the registry.
Value-shaped fields are refused, and a note containing credential-shaped text is refused too.

## Session profiles

| Profile | Environments | Credentials | Writes | Lease | Auto-loadable |
|---|---|---|---|---|---|
| `readonly-reviewer` | development, staging | `gh-token` | none | no | yes |
| `staging-writer` | development, staging | `gh-token`, `supabase-access-token`, `vercel-token` | repo, provider, migrate | **yes** | yes |
| `proof-runner` | development, staging | `gh-token` | none | no | yes |
| `production-readonly` | production | `gh-token` | none | no | yes |
| `production-operation` | production | none | repo, provider, deploy, migrate | **yes** | **no** |

`production-operation` needs an owner-confirmed session permit naming this project, environment and
profile (`projectos session start ... --owner-confirm`). It projects no credential at all — production
work obtains its credential through L4, for one command.

```
projectos session start --slot polygo-1 --profile staging-writer --environment staging \
  --checkout C:\dev\Polygo -- npm run dev
projectos session status
projectos session stop --slot polygo-1
```

## What a session actually gets

The child environment is built fresh. Every variable any registered provider could set is scrubbed from
the inherited copy **first**, unconditionally — so a shell already carrying another project's `GH_TOKEN`
cannot leak it into this session — and only then are this session's own values added. `process.env` is
never modified, so concurrent sessions cannot see each other.

`.projectops/mcp.json` carries `${VAR}` placeholders only, and the session router validates it **at
session start**. The check runs after the project, its canonical root and its session profile are settled
and **before** the writer lease, the identity preflight and any credential retrieval, so a bad config
refuses the session before a single value is read. It needs only the NAMES of the variables the session
will declare — each provider adapter publishes those as `envVars` — so no grant is minted to perform it.

A literal credential is refused; a credential-named key whose value is not a bare placeholder is refused;
a placeholder that resolves to no variable this session declares is refused; and a server this project
does not declare in `providers` is refused. An MCP server started with an unresolved placeholder would
quietly act as an anonymous or wrong principal, so the session is refused with the blocker
`MCP CONFIG INVALID` rather than downgraded to a warning. An absent `.projectops/mcp.json` is legitimate —
a project need not expose MCP servers, and with no config nothing can start as the wrong principal — but a
file that exists and cannot be parsed refuses the session. The Supabase MCP server is structurally
unavailable for production.

## Listing credentials

`credentials status` and every listing path return **target names only** — never a value. The listing
prefix is a **whole-segment** reference prefix: it must either be the complete target name, or the target
must continue after it at a `/` boundary. `ProjectOS/polygo` lists that project; `ProjectOS/poly` does
not, because a string-prefix match would let a listing scoped to one project disclose a sibling named
`polygo2`.

A prefix outside the `ProjectOS` namespace is refused with `CREDENTIAL PREFIX FORMAT INVALID`. So is a
**partial segment** for which matching entries exist — that case previously returned an empty success,
which read as *this project has no credentials* when in fact the prefix was merely mis-shaped. The
refusal counts what the segment boundary dropped; it never prints the sibling's name. A prefix that
legitimately matches nothing still returns an empty list and exit 0.

## One writer per checkout

Any number of readers may share a checkout; at most one modifying session may hold it. Two writers on one
project are legal **only in separate git worktrees**, which is exactly what keying the lease on the
checkout gives you.

The lease key is the SHA-256 of the canonical checkout path (`realpath`, case-folded on Windows), so a
junction, a symlink, a `..` detour or a differently-cased spelling all resolve to one key. Acquisition —
first take and reclaim alike — goes through an atomic exclusive create, so the filesystem picks exactly
one winner. A lease is reclaimed only when its heartbeat has expired **and** its PID is dead; no process
is ever signalled or killed.

## Preflight: READY or one blocker

```
READY
REPOSITORY MISMATCH · GITHUB IDENTITY MISMATCH · SUPABASE PROJECT MISMATCH · VERCEL PROJECT MISMATCH
CREDENTIAL MISSING · CREDENTIAL EXPIRED · WRITE LEASE CONFLICT · OWNER PERMIT REQUIRED
PRODUCTION PROFILE REFUSED
```

There is no partial success and no continue-anyway path. A declared provider with **no** observation is a
mismatch, never a pass — "verified" and "nobody looked" must not produce the same answer.

## High-risk operations

```
projectos operation run --ref ProjectOS/polygo/production/supabase/service-role-key \
  --action read-config --env-var SUPABASE_SERVICE_ROLE_KEY --owner-confirm -- <executable> <args>
```

The chain: provider-intent classification (reusing the existing provider context guards) → an
owner-confirmed permit bound to this project, environment, reference and action → argument hygiene (a
token-shaped argument is refused, and the delivery variable may not be a reserved name like `PATH`) →
executable resolution **before** the single-use grant is minted → exactly one command with the value in
its child environment → exit code returned.

Output is **withheld by default**. Exact-string redaction cannot survive a child that re-encodes,
line-wraps or escapes the value, and this is the highest-risk credential class there is; `--show-output`
is an explicit, informed opt-in.

## Limits you should know about

- **The trust boundary is the OS user, not the process.** Windows Credential Manager credentials are
  readable by anything running as that user. The vault's policy layer constrains ProjectOS's own paths; it
  cannot stop unrelated local code from calling `CredRead` directly. Stronger isolation needs the
  credentials held by a service account under the ProjectOS Windows host — a separate workstream.
- **Redaction is exact-string.** It is a backstop, not a boundary. A transformed or re-encoded copy of a
  secret is not recognised, which is why operation output is withheld rather than scrubbed-and-shown.
- **Provider verification is planned, not performed.** Adapters describe the read-only calls a live phase
  would make and evaluate observations supplied to them; nothing in this capability contacts a provider.
- **`mode: 0o600` is a no-op on NTFS.** The non-secret state files rely on the ACL inherited from
  `%LOCALAPPDATA%\ProjectOS`, not on POSIX permission bits.
- **Fingerprints are not salted per installation.** The same secret in two projects produces the same
  fingerprint — deliberately, since that is how `doctor` can show credential reuse — but it does mean
  fingerprints are comparable across projects.
- **`--owner-confirm` is you asserting consent at your own terminal**, not a proven owner presence. There
  is deliberately **no `--state-dir` flag**: the credential store is machine-wide and is not scoped by
  state directory, so a caller-chosen registry location would let a forged checkout register itself as a
  real project and have the vault release that project's real credential.
- **Secret-shape detection recognises six prefixed token shapes only.** A raw Vercel token, a database
  password or a generic hex key has no distinctive shape. Treat a hit as "definitely refuse", never a miss
  as "definitely safe".
