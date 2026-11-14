# PROJECTOS-PORT-COMPUTER1A: agent computer rules, exec approval binding and a default-deny action policy

Plan v1.36 phase 4 of the port group (delta row 4, C14). Branch `projectos-port-computer1a`, worktree
`C:/dev/ProjectOS-worktrees/port-computer1a-v136`, built on the agents branch (`574a6430`), which sits on the reviewed providers branch
and the shared credit-directories commits. Status: built and committed on the branch. Not pushed, not merged, not closed: closure
is the owner's. `docs/06_Plan.md` is not edited.

## What this phase delivers

Pure rules, a runner behind injected ports, and no process anywhere. A command is read once, made canonical, resolved through a
port and hashed, and it runs only if the policy and the owner's decision say so; a computer action is a policy value with a
machine-readable reason and a class from the action registry; browser and computer use refuse.

- **Exec grants** (core): a decision binds ONE prepared command by the hash of the tenant, project, agent, the exact working
  directory, the environment NAMES, the run limits, the argument list as asked and as launched, and the real executable. A command
  that differs by one byte, a grant past its expiry and a second use are refused. A mismatch does not spend the grant.
- **Exec policy** (core): modes `deny`, `allowlist`, `ask-on-miss` and `ask-always` only. An allowlist entry is an exact canonical
  executable pattern and either the exact arguments or `anyArgs: true`, with the shell syntax it allows (`glob`, `redirection`;
  never chaining, substitution or grouping). The class of `exec-command` is looked up in the action registry; above P3 the owner is
  needed, and P6 is never run.
- **Allowlist patterns and canonical paths** (core): a path has one spelling or is refused (`..`, short names, trailing dots and
  spaces, alternate streams, device names, UNC and extended-length forms, a backslash in a POSIX path, non-ASCII, relative and home
  paths). A pattern that could stand for every executable is refused.
- **Launchers and command lines** (core): `env`, `nohup`, `nice`, `timeout`, `stdbuf`, `busybox` and a plain inline `sh -c`,
  `bash -c`, `cmd /c`, `powershell -Command` are unwrapped to the real command within four levels. `sudo` and its kind, `xargs`,
  `wsl`, `start`, interpreters, `bash -lc`, script files, `-enc` and an `env` option or assignment block. A command line that cannot
  be read completely is refused.
- **Environment names** (core): names only, sorted, and never `PATH`, `PATHEXT`, `COMSPEC`, `NODE_OPTIONS`, `NODE_PATH`, `LD_*`,
  `DYLD_*`, `PYTHON*`, `PERL5OPT`, `RUBYOPT`, `BASH_ENV`, `ENV`, `*_PROXY`, `SSL_CERT_*`, `GIT_*`, `NPM_CONFIG_*`,
  `JAVA_TOOL_OPTIONS`, a credential-looking name, and the rest of the list in `execEnv.ts`.
- **Action policy** (core): a typed default-deny table (no CEL, no dependency), a deny row beating an allow row, a policy that does
  not read refusing everything, a context that lacks a fact its action needs refused, the intent derived and never accepted, and a
  destructive or credential-adjacent action raised to P5.
- **Network policy** (core): `deny_all` or `allowlist_only`, keyed by tenant and project; no row means no network.
- **Sandbox refusal** (core): every browser and computer-use call answers `SANDBOX_NOT_AVAILABLE` until Stage 4.3.
- **Kill plan** (core) and **runner and kill executor** (agent): the steps to stop a process tree, executed through an injected
  spawn port, timer port and environment port, with fakes only.

Nothing outside this module and its tests imports it, except the one `export *` line in the core barrel; `agent/src/index.ts` does
not name the agent directory. The workforce dispatch, the action registry, the approvals module and the agents module are not
changed. No file in either directory imports a child process API, and the validator refuses one (comments stripped first).
No gate was loosened or replaced.
No dependency was added: `core` stays dependency-free and the agent keeps only `@projectos/core`.

## Existing code found (Code Bible B1, before any file was written)

Searched `core/src` and `agent/src` for exec, spawn, process, allowlist, approval, sandbox, computer, kill, policy and the action classes.

| Found | Where | What this phase did with it |
|---|---|---|
| `resolveAction`, `classAtMost`, the registered classes (an unregistered action is P5; P6 is nobody's) | `core/src/actionRegistry.ts`, `security/action-registry.json` | **Reused, not redefined.** The class of `exec-command` and of every `computer-<tool>` is looked up. The registry lists none of them, so each reads as P5. Nothing was added to the registry (that is the P5 action `action-registry-change`) |
| `resolveTenant`, `isDerivedBinding`, `TenantBinding` | `core/src/tenant.ts` | Every grant, hash, store key and network row is under the tenant and project of a derived binding. Unchanged |
| The tool approvals: an owner decision on one effect, spent once, provenance by `WeakSet`, `taintClear` and never "allowed" | `core/src/approvals/toolApproval.ts` | **Shape followed, not reused.** That module is about a run's taint and tool effects, and the port-directory fence forbids this directory importing it. The same rules are applied here to a command hash |
| The agents port's clock reader and plain-record reader | `core/src/agents/clockGuard.ts`, `plainRecords.ts` | Read only. This directory has its own small copies (`clock.ts`, `plainFields.ts`) because the agents validator refuses any other module reaching into `agents/` |
| `GRANTABLE_TOOLS` (a closed list with no shell), `requestProtectedAction`, the one dispatch | `agent/src/workforce/` | Read only. The workforce holds no shell grant and stays the only queue. Nothing here dispatches |
| `child_process` users: the loop adapters, the transports, `system.ts`, the commands | `agent/src/loop/`, `agent/src/system.ts`, `agent/src/commands/` | Different concerns (the existing governed runs). Unchanged. None of them is imported by this module |
| The model broker's per-key attempt store, the connector retry vocabulary | `core/src/modelBroker/`, `core/src/connectorContract.ts` | Read, not reused: they count attempts of a call, not the single use of a grant |
| The skills guard patterns | `core/src/skills/guardPatterns.ts` | Read only. A different list (what a skill may say), not what a command may run |
| The sibling ports' validators and finish records | `val-projectos-port-search1a.cjs`, `-providers1a.cjs`, `-agents1a.cjs` | The shape followed: pure core, credit headers, behaviour run against the real source, named mutations |

Everything this phase touched is inside the approved row: `core/src/computer/`, `core/src/index.ts`, `core/test/`,
`agent/src/computer/`, `agent/test/`, `THIRD_PARTY_NOTICES`, this phase's validator, the two registration lists and `docs/finish/`.
The shared commit `86f18e23` lists these directories (`core/src/computer` and `agent/src/computer`, with `agents` and `research`
added in `44d27a63`) in the credit validator and ADR-P1 section 7, so this phase edits neither.

## Ported files and the upstream file behind each

Every ported file carries its credit header and a `THIRD_PARTY_NOTICES` entry per source path (OpenClaw files also credit pi-mono).
The pins are the commits inside the owner's downloads of 2026-11-01: OpenClaw `c5b56f2505c4f6a5803125d2923e2934c5f750af`, OpenBot
(CopilotKit) `c396a5f68c817043846f1ca3c2b42061ee73ceb5`.

| ProjectOS file | Upstream | Source path | Licence | Strategy |
|---|---|---|---|---|
| `core/src/computer/allowlistPattern.ts` | OpenClaw | `src/infra/exec-allowlist-pattern.ts` | MIT | ADAPT |
| `core/src/computer/wrapperResolution.ts` | OpenClaw | `src/infra/exec-wrapper-trust-plan.ts`, `src/infra/dispatch-wrapper-resolution.ts`, `src/infra/shell-wrapper-resolution.ts`, `src/infra/exec-wrapper-tokens.ts` | MIT | ADAPT |
| `core/src/computer/execCommand.ts` | OpenClaw | `src/infra/exec-command-resolution.ts`, `src/infra/exec-approvals-core.ts`, `src/infra/exec-argv-analysis.ts`, `src/infra/exec-safety.ts` | MIT | ADAPT |
| `core/src/computer/execPolicy.ts` | OpenClaw | `src/infra/exec-approvals-core.ts`, `src/infra/exec-command-resolution.ts` | MIT | ADAPT |
| `core/src/computer/execGrants.ts` | OpenClaw | `src/infra/exec-approvals-core.ts` | MIT | ADAPT |
| `core/src/computer/execDisplay.ts` | OpenClaw | `src/infra/exec-approval-text-sanitize.ts`, `src/infra/exec-approval-command-display.ts` | MIT | ADAPT |
| `core/src/computer/processTree.ts` | OpenClaw | `src/process/kill-tree.ts`, `packages/agent-core/src/harness/env/kill-tree.ts` | MIT | ADAPT |
| `core/src/computer/actionContext.ts` | CopilotKit OpenBot | `server/src/computer/policy.ts` | MIT | ADAPT |
| `core/src/computer/actionPolicy.ts` | CopilotKit OpenBot | `server/src/computer/policy.ts` | MIT | ADAPT |
| `core/src/computer/networkPolicy.ts` | CopilotKit OpenBot | `server/src/computer/policy-network.ts` | MIT | ADAPT |
| `agent/src/computer/execRunner.ts` | OpenClaw | `src/process/exec-runner.ts`, `src/process/exec-result.ts` | MIT | ADAPT |
| `agent/src/computer/killTree.ts` | OpenClaw | `src/process/exec-termination.ts`, `src/process/kill-tree.ts` | MIT | ADAPT |

The OpenClaw exec-approval files this phase ports, by path: `src/infra/exec-allowlist-pattern.ts`,
`src/infra/exec-approvals-core.ts`, `src/infra/exec-command-resolution.ts`, `src/infra/exec-argv-analysis.ts`,
`src/infra/exec-safety.ts`, `src/infra/exec-wrapper-trust-plan.ts`, `src/infra/dispatch-wrapper-resolution.ts`,
`src/infra/shell-wrapper-resolution.ts`, `src/infra/exec-wrapper-tokens.ts`, `src/infra/exec-approval-text-sanitize.ts` and
`src/infra/exec-approval-command-display.ts`. From `src/process/`: `kill-tree.ts` (a barrel; the logic is in
`packages/agent-core/src/harness/env/kill-tree.ts`), `exec-termination.ts`, `exec-runner.ts` and `exec-result.ts`.

Original ProjectOS code, marked `// Origin: original ProjectOS code`: `clock.ts`, `canonicalJson.ts`, `pathCanon.ts`,
`commandLine.ts`, `execEnv.ts`, `plainFields.ts`, `execLaunch.ts`, `sandboxRefusal.ts`, `untrustedOutput.ts`, both `index.ts`
files and `agent/src/computer/ports.ts`. `openbot-lower` (nightly-labs, PolyForm Noncommercial) was never opened and no
`DO-NOT-PORT` file was. No xAI or Grok path exists. Vendor folders were read only, and nothing was installed or run from them.

Not ported, and why: the other `exec-approval*` files (the channel runtime, the forwarder, the reply formatter, the session
target, the surface and the policy snapshot: chat and gateway delivery), `exec-approvals-allowlist.ts` and the analysis and
authorization worker files (coupled to the gateway config and the SQLite store), the safe-binary tables, `command-carriers.ts`,
`exec-host*`, `src/process` lanes, queues, PTY and Windows spawn code (they start processes), OpenBot `policy-dry-run.ts`,
`policy-listener.ts` and `policy-store.ts` (dry-run, a database and a notification bus), the CEL evaluator, the sandbox container
backend (it waits for the Stage 4.3 design), and everything Hermes (REFERENCE only).

## What changed from the sources, and what was refused

- **OpenClaw's `full` exec security, `/elevated full`, the auto-review mode and the persisted allow-always entries are not
  here.** The modes are `deny`, `allowlist`, `ask-on-miss` and `ask-always`; a mode this module does not know is refused when a
  policy is compiled, and a decision of `allow-always` is not in the vocabulary.
- **OpenClaw matches a bare `*` entry and basename entries, and a pattern is resolved with `realpath` at match time.** Cut. A
  bare wildcard, a wildcard in the first segment and a recursive wildcard with fewer than two literal segments before it are
  refused; the real path comes from an injected resolver, and a path with no canonical spelling is never matched.
- **OpenClaw's approval binding hashes a NUL-joined string of the arguments and the cwd.** Here the hash is of canonical JSON of
  everything that decides what runs (tenant, project, agent, cwd bytes, environment names, limits, the argument list as asked and as
  launched, the real executable), so no two commands share a hash and no field can be moved across a boundary.
- **OpenClaw's `env` wrapper accepts options and assignments.** Blocked here: a value never rides in a request.
- **OpenBot's policy mode `dry-run` "lets everything through".** Removed. There is no mode that decides and then forwards.
- **OpenBot's policy is a list of CEL expressions.** Replaced by a typed default-deny table, so no expression language and no
  dependency; an unknown field, a value it cannot read completely or one bad row refuses the whole policy. A deny row still beats an
  allow row, and an absent or uncompiled policy still refuses.
- **OpenBot bound an empty neutral value for a fact an action lacked.** A click without its element, a navigation without a page, a
  file action without a file and a command without its text are `CONTEXT_INCOMPLETE`, because a rule about a missing fact would read
  as false and let the action through. The intent is derived here and a context that states its own is refused.
- **policy-network.ts differs from the earlier pin and was reviewed in this phase (it is pinned at `c396a5f` here).** The
  difference is not behavioural in the part ported: the push, wake and fetch code is cut. The part ported contained a fail-open
  default: no organization row meant allow all (`NO_NETWORK_POLICY` is `allow_all`). Here no row, a capability that is off, a row
  that does not read, a row asking for allow all and a row of another tenant or project are all `deny_all`, and there is no
  allow-all mode.
- **OpenClaw's `kill-tree.ts` is a barrel; the logic is in `packages/agent-core`.** The platform reads, signals and timers are
  cut. The policy is kept as a plan: never signal pid 0, a negative pid or pid 1; never this process or its own group; a group only
  on a boolean fact that the process leads one (the source trusted `detached: true`); terminate, then force after a bounded grace
  period, and only if the child is still running.

## Refusals, and the rule each is held by

| Refusal | Rule |
|---|---|
| A command with one byte of argv, cwd, environment names, limits, agent or real executable changed; an expired grant; a second use; a command of another project | CP-1 |
| A lifetime past the cap, below the floor or not whole; a decision that names its own expiry, is not the owner's, or is `allow-always`; a decision id used twice; a full store | CP-2 |
| An action no row allows; an absent or uncompiled policy; a context that lacks a fact; a destructive, credential-adjacent or P5 action; an unregistered action (P5) | CP-3 |
| An allowlist hit that skips the class, the exact arguments or the syntax; a mode that is not deny, allowlist, ask-on-miss or ask-always | CP-4 |
| A `..`, a short name, a trailing dot or space, a look-alike letter, a device path, a stream, a backslash in a POSIX path; a pattern for every executable | CP-5 |
| `sudo`, an interpreter, `xargs`, `wsl`, a shell script, `bash -lc`, `-enc`, an env assignment or option; a line with chaining, substitution, grouping or an open quote; a loader or credential environment name | CP-6 |
| Any browser or computer-use call answered with anything but `SANDBOX_NOT_AVAILABLE` | CP-7 |
| Pid 0, a negative pid, pid 1, this process or its group; a group kill on a truthy flag; an unbounded grace | CP-8 |
| No network row, a capability that is off, a row asking for allow all, a row of another scope, an address rule | CP-9 |
| Output that is trusted, unbounded or closes its own fence | CP-10 |
| A command shown with a hidden character or without its word boundaries | CP-11 |
| A plan run twice, a failed start retried, a timer left running, a force sent to an exited child, an unbounded capture, this process signalled | CP-12 |
| Any import or call of a child process API in either directory | CP-13 |
| A timer, a clock, module state or a foreign import in this module | CP-14 |
| Any importer of the module outside its directory and tests, by name or by path | CP-15 |
| A clock that runs backwards, is not whole, is past the last instant, or throws | CP-22 |

## Acceptance criteria to tests

| Criterion | Tests |
|---|---|
| An approved command is refused if its argv, cwd or hash changes by one byte, after expiry, or on a second use | `computer-grants.test.ts` "refuses the command if one byte of its argv changes", "refuses the command if its cwd changes by one byte", "refuses the command if its hash changes", "refuses after expiry, at the instant it expires and after", "refuses a second use, and never reopens a spent grant", with "issues a grant for the owner decision on one prepared command and spends it once" as the control |
| An action no policy row allows is refused, with an allowed control | `computer-policy.test.ts` "refuses an action no row allows", "allows an action a row names, under a class that runs unattended", "refuses when there is no policy", "lets a deny row beat an allow row" |
| Every browser or computer-use call returns SANDBOX_NOT_AVAILABLE | `computer-sandbox.test.ts` "answers SANDBOX_NOT_AVAILABLE to every browser call", "...every computer-use call", "refuses even a call a policy allows" |
| The validator refuses any import of node:child_process in this module and its agent side | Validator CP-13 and its six mutations; the runner and kill executor tests run against fakes only |
| The finish record lists every upstream exec-approval file ported, by path | The section above; validator CP-21 pins each path |
| Credit header, notices entry, credit validator | CP-16; the credit validator passes (see Checks) |
| The validator refuses any importer outside the module | CP-15 and its mutations |
| Validator pin and named mutations | See below |

## Mutations

Taken from the validator's own output, not from this document: see Checks. Every behaviour mutation is applied in memory to a copy of
the real core and agent source that Node compiles and runs, and counts as killed only when the scenario it names goes the wrong way,
by the rule and not by a crash. A refusal is killed only when the refused call now goes THROUGH: refused under another name is a
second defence behind the rule and proves nothing. Mutations are named after the rule body, for example
`a-changed-command-is-spent-on-an-old-grant`, `the-working-directory-is-not-hashed`, `a-mismatched-command-spends-the-grant`,
`a-full-store-evicts-the-oldest-grant`, `a-short-name-is-a-name`, `a-semicolon-is-a-letter`, `a-deny-row-is-not-read-first`,
`an-unregistered-action-is-p2`, `a-truthy-leader-flag-makes-a-group`, `no-row-is-allow-all`, `a-failed-start-is-retried`,
`the-force-is-sent-to-an-exited-child`.

**Second defences, not mutation-proved.** Some refusals stand behind another one, so no single mutation can free the call, and the
scenario for each is a control. The explicit P6 refusals are a second defence behind the class ceiling: P6 is above P3, so it is
refused as `needs the owner` even without them, and the answer only differs in the reason code.
The path style check is a second defence: a POSIX canonical path always starts with `/` and a Windows one never does, so a pattern of one style cannot match a
target of the other whether or not the style is compared. A grant of another project is unknown in this one, and a grant id also
carries the scope in its hash, so the scoped key is a third defence behind the hash and the scope check. The `~` home prefix and a
relative path are both refused as not absolute. A `..` segment is refused twice (its own check and the trailing-dot check, because
`..` ends in a dot), so its mutation removes both. Three more rules have a second defence that the validator takes away in the same
mutation (`also` edits), so the rule is judged alone: the `submit` intent behind the P5 floor of a submitted type, a control
character behind the non-ASCII check, and the trailing-dot check behind `..`. An absent policy is refused by the `WeakSet` brand check that also refuses a hand
made one. These are listed here so a reviewer does not read their controls as proofs.

## Design notes the reviewers should check

- **A grant spends before the runner starts, and nothing re-opens it.** `consume` marks the grant spent and then returns the
  plan; a runner that fails, times out or is killed leaves it spent. The runner marks the plan run before it starts the child, and
  `start` throwing does not prove nothing started, so the outcome says `actedUnknown: true` and nothing retries.
- **Every count is keyed by tenant, project and id as a JSON array.** The grant store, the decision ids, the per-project room, the
  network rows and the hash itself.
- **The store is bounded and never evicts a live entry.** Expired entries are dropped when a decision is issued; when 16 live
  grants are held for a project (256 overall), a new decision is refused.
- **A caller-supplied value is never a bound.** The clock is the store's own, injected at creation and monotonic; the lifetime is
  held to a ten-minute cap and refused past it; the limits are held to caps and refused past them; the pid, group and grace of a kill
  are checked; a boolean flag must be `true`, not truthy.
- **Output is data.** What a command printed, bounded to the plan's byte cap and then to the fence cap, is labelled
  `untrusted-data` and fenced by the hash of the exact body.
- **The class is looked up, never said.** There is no field a caller could use to say it.

## Residuals and what this module cannot prove

- A well-formed record that names a decision id is not an approval.
  That a decision id is the owner's real, authenticated decision is the caller's to prove, as it is for the tool approvals; the wiring phase must replace that trust before this is used.
- Until the registry lists exec-command and the computer actions, every one reads as P5, so no allowlist hit runs without a grant
  and no action policy row allows. This is the safe default and the reason nothing here is switched on. Adding the rows is an
  `action-registry-change`, which is the owner's, and it belongs with the Stage 4.3 wiring.
- That the resolver port's real path is the file it names, and that it is still that file when the command is launched, are the
  port's and the runner's. The hash catches a path that changed between the decision and the launch, not after.
- A restart forgets every grant: the store is in this process's memory. That only ever refuses. A grant spent in another process is
  not seen here.
- The explicit P6 refusals are a second defence behind the class ceiling, and the path style check is a second defence behind the
  path forms themselves; see the mutation section.
- Non-ASCII executable paths are never matched (a look-alike letter must not be matched as the letter it imitates), so an
  allowlisted executable in a directory with a non-ASCII name cannot be allowed here. The working directory is hashed by its exact
  bytes and may be non-ASCII.
- A launcher or interpreter not in the lists falls through as the command itself and is judged by its real path. A file called
  `git` that is really a shell is for the allowlist and the resolver to catch by the real path.
- A host name that resolves to a private address is the egress layer's to refuse at connection time; a name check cannot.
- Chaining cannot be allowed by an allowlist entry here: running a chain needs a shell, and no shell runs. This is stricter than
  the brief's "unless the pattern allows them", which holds for globs and redirection only (kept as literal text in an argument).
- The runner and the kill executor are written against ports and tested with fakes; the real spawn port, the Windows `taskkill`
  and Linux procfs behaviour belong to the Stage 4.3 sandbox.
- Tests were written beside the code, not first; the proof of each rule is the mutation that removes it and the scenario that goes
  the wrong way.

## Checks

Exit codes and counts are from the runs themselves, not from this document. `validate-all` was not run (the lead runs it).

```text
core: npm run -s build                                    exit 0
core: npx vitest run                                      75 files, 3274 tests passed (this phase: 6 files, 95 tests)
core: vitest --coverage on src/computer (earlier run)     99.9% statements, 94.1% branches, 99.0% functions
agent: typecheck of src, ALIAS to this worktree's core/dist   exit 0   (the agent's own @projectos/core junction points at another worktree)
agent: typecheck of src/computer + the runner test, ALIAS     exit 0
agent: vitest computerRunner.test.ts, ALIAS config            18 tests passed (the alias config was a temporary file, not committed)
val-projectos-port-computer1a                             PASS (206 scenarios; 178 behaviour and 92 text mutations killed)
val-projectos-port-credit1a                               PASS (115 real file(s) judged; 157 fixture and 59 record mutations killed)
validate-no-secrets                                       PASS
val-projectos-connector-contract1a                        PASS (38 rules; 293 named mutations killed)
val-projectos-port-agents1a / -approvals1a / -context1a / -memory1a / -providers1a / -search1a / -skills1a   PASS (all seven)
val-projectos-kernel-followup1a, tenant-contract1a, -credentials1a, -csp1a, -principal1a, credential-vault1a,
  packaged-runtime-contract1a, release-workspace-freshness1a                                               PASS (all eight)
```

The mutation counts are the validator's own output. The registration is in both lists, in the same position and order, before
`val-projectos-connector-contract1a`, which pins its own entry as the last one. The agent checks ran through an alias config, as
the brief said, because the agent's `@projectos/core` junction points at another worktree.

## Converge (Code Bible B9)

Reconciled against the delta spec row 4 and ADR-P1 after the code was written. The module is the approved shape: exec grants
bound to argv, cwd and hash that expire and are single use; a default-deny action policy as a typed table; allowlist patterns; a
kill plan and a runner behind an injected spawn port with fakes only; browser and computer use that refuse until Stage 4.3. Nothing
was added to the action registry, the tenant registry, the closure authority, the owner floor, the gatekeeper or the credential
custody. Every file in the module has its credit header or its original mark, and every ported file has its notices entry. Nothing
in PROTECTED was touched: the only edits outside this phase's own files are the one core barrel line, the notices entries, and the
registration of the validator in the two lists, in the same position and order, before the connector-contract entry. Two things the
approved row did not name: `execDisplay.ts` (the text an owner reads is part of what a decision binds to, and the OpenClaw display
sanitizer is an exec-approval file) and `networkPolicy.ts` (the policy-network file the port map told this phase to review).

ECC SECURITY and Agency `application-security-engineer` reviews are requested for this phase.
