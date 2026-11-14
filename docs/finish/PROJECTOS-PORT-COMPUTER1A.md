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
  that differs by one byte, a grant past its expiry and a second use are refused. A mismatch does not spend the grant. A decision
  carries the hash the owner was shown and is asked of an injected verifier port that must answer exactly `true` (round 1, H1); the
  agent is the caller's and never a request field; a decision id is kept for good, bounded per tenant and project.
- **Exec policy** (core): modes `deny`, `allowlist`, `ask-on-miss` and `ask-always` only. An allowlist entry is an exact canonical
  executable pattern and either the exact arguments or `anyArgs: true` (never for git, find, tar, curl, wget arguments that run or
  write something, nor for a tool that runs what it is handed), the directories it may run in (by segment) and the shell syntax it
  allows (`glob`, `redirection`; never chaining, substitution or grouping). The class of `exec-command` is looked up in the action
  registry; above P3 the owner is needed, and P6 is never run. ONE gate (`gateExecPolicy`) clears an allowlist plan and a grant at
  the moment it is spent, so a grant never beats deny mode or a class that is never run (round 1, H2).
- **Allowlist patterns and canonical paths** (core): a path has one spelling or is refused (`..`, short names, trailing dots and
  spaces, alternate streams, device names, UNC and extended-length forms, a backslash in a POSIX path, non-ASCII, relative and home
  paths). A pattern that could stand for every executable is refused.
- **Launchers and command lines** (core): `env`, `nohup`, `nice`, `timeout`, `stdbuf`, `busybox` and a plain inline `sh -c`,
  `bash -c`, `cmd /c`, `powershell -Command` are unwrapped to the real command within four levels. `sudo` and its kind, `xargs`,
  `wsl`, `start`, interpreters, `bash -lc`, script files, `-enc` and an `env` option or assignment block. A command line that cannot
  be read completely is refused.
- **Environment names** (core): names only, sorted, from a small ALLOW-LIST (`LANG`, `LANGUAGE`, `TERM`, `TZ`, `COLORTERM`,
  `NO_COLOR`, `CI`, `LC_<LETTERS>`); every other name is refused. A deny-list stays behind it as a second defence: `PATH`,
  `PATHEXT`, `COMSPEC`, `NODE_OPTIONS`, `NODE_PATH`, `LD_*`, `DYLD_*`, `PYTHON*`, `PERL5OPT`, `RUBYOPT`, `BASH_ENV`, `ENV`, `*_PROXY`,
  `SSL_CERT_*`, `GIT_*`, `NPM_CONFIG_*`, `JAVA_TOOL_OPTIONS`, `SUPABASE_*`, `AWS_*`, `DATABASE_URL`, a credential-looking name and the
  rest of the list in `execEnv.ts`.
- **Action policy** (core): a typed default-deny table (no CEL, no dependency), a deny row beating an allow row, a policy that does
  not read refusing everything, a context that lacks a fact its action needs refused, the intent derived and never accepted, and a
  destructive or credential-adjacent action raised to P5. Text from a page is stripped of hidden characters, folded (NFKC, case,
  look-alikes) before any rule reads it; the destructive words, the credential paths and the key spellings are the wide lists of
  round 1; a command is a prepared command and never free text.
- **Network policy** (core): `deny_all` or `allowlist_only`, keyed by tenant and project; no row means no network. A group row never
  widens the organization row: every applying row must allow a host.
- **Sandbox refusal** (core): every browser and computer-use call answers `SANDBOX_NOT_AVAILABLE` until Stage 4.3.
- **Kill plan** (core) and **runner and kill executor** (agent): the steps to stop a process tree, executed through an injected
  spawn port, timer port, environment port and plan-gate port, with fakes only. The runner refuses a plan that is past its expiry,
  was cleared under another policy or is for a revoked grant (round 1, H2).

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

Original ProjectOS code, marked `// Origin: original ProjectOS code`: `clock.ts`, `hiddenText.ts` (new in round 1),
`canonicalJson.ts`, `pathCanon.ts`,
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
  grants are held for a project, a new decision is refused. Decision ids are kept for good (1,024 per tenant and project); a full
  set refuses a new decision and never forgets an old id. A denial counts against the ids and not against the live grants.
- **A caller-supplied value is never a bound.** The clock is the store's own, injected at creation and monotonic; the lifetime is
  held to a ten-minute cap and refused past it; the limits are held to caps and refused past them; the pid, group and grace of a kill
  are checked; a boolean flag must be `true`, not truthy.
- **Output is data.** What a command printed, bounded to the plan's byte cap and then to the fence cap, is labelled
  `untrusted-data` and fenced by the hash of the exact body.
- **The class is looked up, never said.** There is no field a caller could use to say it.

## Review round 1 (ECC security-reviewer and Agency application-security-engineer, on `f1500a7a`)

Both reviewers reproduced their findings. This round fixes them on top of the merge `232fc5cc`. The first builder was cut off by a
usage limit and left the WIP commit `90ef9942`; its source for grants, policy, the action floor, the environment and the network
compiled after two repairs, and its tests are kept. The runner side (the plan gate, the kill degrade, the group sweep, the bounded
start error), the old tests brought up to the new API and the validator were done in this pass. Each fix has a named validator
mutation (see the validator output for the counts); the scenario is the reviewer's input where there was one.

| Finding | Fix | Proof: test and named mutation |
|---|---|---|
| H1 grant minting trusted a string | A decision carries the hash the owner was shown and `issue` refuses unless it is the prepared command's (`HASH_MISMATCH`, `DECISION_SHAPE`); an injected verifier port must answer exactly `true`, none or a throw or a truthy value mints nothing (`UNVERIFIED`); a decision id is a permanent tombstone per tenant and project, a full set refuses (`STORE_FULL`) and never evicts; the agent is `prepareExecCommand`'s fourth argument and `consume`'s, never a request field (`REQUEST_SHAPE`, `AGENT_ID`, `AGENT_MISMATCH`); the run-command context takes a prepared command and carries its hash, never free text | `computer-review1.test.ts` "refuses a decision when the store has no verifier port", "keeps a decision id for good", "takes the agent from the caller, never from the request", "takes the command of a run-command from a prepared command"; mutations `no-verifier-is-a-yes`, `a-truthy-verifier-answer-mints`, `the-shown-hash-is-not-compared`, `the-oldest-decision-id-is-forgotten`, `any-agent-spends-the-grant`, `a-free-command-text-is-read` |
| H2 `consume` ignored policy | ONE gate (`gateExecPolicy`) clears an allowlist plan and a grant, at the moment the grant is spent; a plan carries an expiry (one minute, never after its grant) and the digest of its policy; `runExecPlan` asks a gate port for the time, the policy in force and the grant, and refuses `PLAN_EXPIRED`, `POLICY_CHANGED`, `GRANT_REVOKED`, `GATE_UNAVAILABLE` before anything starts | `computer-review1.test.ts` "runs the one policy gate at consume", "carries an expiry and a policy digest on every plan"; `computerRunner.test.ts` "the computer runner refuses a plan that went stale"; mutations `a-grant-runs-whatever-the-policy-says`, `a-class-nobody-may-run-passes-the-gate`, `deny-mode-passes-the-gate`, `a-stale-plan-runs`, `a-plan-under-another-policy-runs`, `a-plan-for-a-revoked-grant-runs` |
| H3 the computer action P5 floor was evadable | Text is stripped of hidden characters and folded (NFKC, case, look-alikes) in `hiddenText.ts` before any rule reads it; the destructive and credential word lists are wide and apply to the title, url, label and role; key chords are normalised (KP_Enter, Ctrl+Enter, spacebar, Alt+F4, Delete, Backspace); typed text with a newline submits; the credential paths cover the wider list; a file prefix matches by whole segments; an `mcp-read` that says it writes floors as a write | `computer-review1.test.ts` "the computer action floor cannot be evaded"; mutations `hidden-characters-are-not-stripped`, `text-is-not-normalised`, `a-lookalike-is-a-letter`, `a-title-is-not-read`, `a-modifier-hides-the-key`, `alt-f4-is-an-ordinary-key`, `typed-newlines-do-not-submit`, `a-pem-file-is-not-a-credential`, `a-path-prefix-matches-the-start-of-a-name`, `a-read-tool-that-writes-is-a-read` |
| M1 exec allowlist | The RESOLVED path's normalised name is re-checked against the launcher, shell and interpreter list (`rbash`, `py`, `pypy3`, `find`, `awk`, `npx`, `strace`, `ksh93`, `java`, `dotnet`, a trailing dot or space, a version suffix, a `.exe` suffix); a `.cmd`, `.bat`, `.ps1`, `.vbs`, `.com`, `.scr` or `.lnk` target is refused; `anyArgs` never reaches the arguments of git, find, tar, curl or wget that run or write, nor a tool that runs what it is handed, and an entry can name arguments it never allows; an entry names its directories (by segment, canonical, no network share) and a hit also checks the directory and the environment names | `computer-review1.test.ts` "the exec allowlist re-checks the resolved path"; mutations `a-resolved-shell-is-a-command`, `a-resolved-versioned-shell-is-a-command`, `a-resolved-batch-file-is-a-command`, `git-config-overrides-are-open-arguments`, `a-tool-that-runs-what-it-is-handed-takes-open-arguments`, `any-directory-is-the-entrys`, `a-directory-is-matched-by-name-prefix` |
| M2 environment names | A small allow-list (`LANG`, `LC_*`, `TERM`, `TZ` and the rest named above); everything else refused; the secret and loader families stay on the deny list behind it | mutations `a-name-off-the-allow-list-is-allowed`, `a-secret-family-name-is-allowed` and the loader, proxy and credential mutations (each also removes the allow-list so the deny rule is judged alone) |
| M3 network policy | A `locked` that is not a boolean, or any malformed row, is deny all; every applying row must allow a host, so a group never widens and the most restrictive wins whatever the order; numeric, hex, octal, decimal and IPv6 literals, a bare top-level wildcard (`*.com`, `*.*`) and a wildcard on a two-label public suffix are not rules or hosts | mutations `a-group-widens-the-organization-row`, `only-the-first-applying-row-is-read`, `a-locked-flag-need-not-be-a-boolean`, `a-bare-top-level-wildcard-is-a-rule`, `a-wildcard-on-a-public-suffix-is-a-rule`, `a-numeric-host-rule-is-a-rule` |
| M4 grant store | The live-grant limit is per tenant and project; a denial counts against the decision ids and never against the live grants | mutation `a-denial-counts-against-the-live-grants`; the 256 total was removed |
| M5 kill path | A group kill refused as unsafe (own group, unknown group) degrades to a forced kill of the handle's own pid, never zero signals; a detached leader that exited on its own has its whole group swept (never a bare pid); the final force is not skipped once a stop began; a non-leader off Windows and Linux gets the tree, not a root-only kill; a start error is bounded and fenced as untrusted data | `computerRunner.test.ts` "still stops a timed-out detached child whose own group is not known", "sweeps the group of a leader that exited on its own", "forces a child that is still running when the run ends", "bounds a start error"; mutations `an-unknown-group-is-zero-signals`, `a-leaders-group-is-not-swept`, `a-sweep-signals-a-bare-pid`, `a-stopped-child-is-not-forced-after-a-stop-began`, `a-non-leader-gets-a-root-only-kill`, `a-start-error-is-unbounded` |
| M6 output fence and command line | ANSI and bidi and zero-width characters are stripped from output; only the fenced form leaves (no `body`); a body cannot close a hash-derived fence; `commandLine` refuses U+00AD, U+034F, U+061C, U+3164, U+FFFC and a full-width dollar or percent; the working directory is canonical with no network share; the forward clock jump is refused until it catches up and is tested | `computer-review1.test.ts` "strips ANSI and bidi", "refuses a soft hyphen", "refuses a clock that jumped forward and was corrected"; mutations `the-body-leaves-with-its-fence`, `output-keeps-its-escape-sequences`, `a-soft-hyphen-is-a-letter-in-a-line`, `a-full-width-dollar-is-a-dollar-in-a-line`, `a-network-share-is-a-working-directory` |

Deferred, with a residual line: the registry rows for `exec-command` and `computer-*`, and the real resolver and spawn port (see
Residuals). Nothing from the fix list was dropped.

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
- A launcher or interpreter not in the lists falls through as the command itself and is judged by its real path. Round 1 added
  the re-check of the RESOLVED real path (a shell, interpreter, launcher or a tool that runs what it is given is refused by its
  normalised name; a `.cmd`, `.bat`, `.ps1`, `.vbs`, `.com`, `.scr` or `.lnk` target is refused outright), so a file called
  `git` that resolves to a shell is refused. A binary that is renamed to something not in the lists is still the resolver's.
- **Deferred in round 1, by the fix list:** (1) the registry rows for `exec-command` and `computer-*` (an owner-gated
  `action-registry-change`; until then every one reads P5, which fails closed); (2) the real resolver and spawn port. It must
  refuse `.cmd` and `.bat` targets (the BatBadBut class), resolve through the real file system and be conformance-tested against
  this module's path rules before anything is switched on. The ports contract text in `agent/src/computer/ports.ts` states what a
  port promises; the conformance suite is the Stage 4.3 phase's.
- **A clock that jumped forward and was corrected is refused until it catches up** (the grant store and the runner gate keep the
  latest instant seen and refuse earlier ones). That is the safe side and is tested; the gate's last-seen instant is a `WeakMap`
  keyed by the gate object, which holds nothing a caller can read.
- **A group sweep is sent to a group id after its leader exited.** That is a group signal only, never a bare pid, and only for a
  leader the port says leads a whole group that is not this process's own. A group id could in principle be reused by another
  process once its members are all gone; the port must refuse to signal a group it cannot show is still the child's.
- **Second defences not mutation-proved in round 1:** the re-check of environment names at an allowlist hit (a prepared command
  can only be minted with names the allow-list admitted, so no scenario can reach it), and the resolved-path and launcher checks,
  which stand behind each other (each mutation removes both so that the rule is judged alone).
- A host name that resolves to a private address is the egress layer's to refuse at connection time; a name check cannot.
- Chaining cannot be allowed by an allowlist entry here: running a chain needs a shell, and no shell runs. This is stricter than
  the brief's "unless the pattern allows them", which holds for globs and redirection only (kept as literal text in an argument).
- The runner and the kill executor are written against ports and tested with fakes; the real spawn port, the Windows `taskkill`
  and Linux procfs behaviour belong to the Stage 4.3 sandbox.
- Tests were written beside the code, not first; the proof of each rule is the mutation that removes it and the scenario that goes
  the wrong way. In round 1 the reviewers' failing inputs are in `computer-review1.test.ts` (written by the builder that was cut
  off by a usage limit, with its source changes) and in the runner tests; the second builder wrote the runner changes and their
  tests in one pass, so "failing test first" is not claimed for them. Each fix has a named validator mutation that was applied and
  killed by its own scenario (the validator's output is the proof, not this table).

## Checks

Exit codes and counts are from the runs themselves (round 1, this pass), not from this document. `validate-all` was not run (the lead
runs it).

```text
core: npm run -s build                                    exit 0
core: npx vitest run                                      79 files, 3381 tests passed (this phase: 7 files, 130 tests)
core: vitest --coverage on src/computer                   99.91% statements, 93.78% branches, 100% functions
agent: typecheck of src/computer + the runner test, ALIAS to this worktree's core/dist   exit 0
agent: vitest computerRunner.test.ts, ALIAS config            29 tests passed (the alias config was a temporary file outside the repository, not committed)
val-projectos-port-computer1a                             PASS (296 scenarios; 267 behaviour and 112 text mutations killed)
val-projectos-port-credit1a                               PASS (118 real file(s) judged; 157 fixture and 59 record mutations killed)
validate-no-secrets, validate-plan-no-secrets             PASS
val-projectos-connector-contract1a                        PASS (38 rules; 293 named mutations killed)
val-projectos-port-agents1a / -approvals1a / -context1a / -memory1a / -providers1a / -search1a / -skills1a   PASS (all seven)
val-projectos-kernel-followup1a, tenant-contract1a, -credentials1a, -csp1a, -principal1a, -rls1a, credential-vault1a,
  packaged-runtime-contract1a, release-workspace-freshness1a                                               PASS (all nine)
val-projectos-agent-workforce1a, worker-lifecycle-bounded1a, live-gate-owner-floor1a, host-review-path1a,
  technical-continuation1a                                                                                 PASS (all five)
```

The mutation counts are the validator's own output. The registration is in both lists, in the same position and order, before
`val-projectos-connector-contract1a`, which pins its own entry as the last one; this round did not touch either list. The agent
checks ran through an alias config because the agent's `@projectos/core` junction points at another worktree. The agent package
was not typechecked as a whole through the alias, only `src/computer` and the runner test (nothing else in the agent changed).

## Converge (Code Bible B9)

Reconciled against the delta spec row 4 and ADR-P1 after the round 1 code was written. The module is still the approved shape:
exec grants bound to argv, cwd and hash that expire and are single use, now also bound to a shown hash and a verifier port; a
default-deny action policy as a typed table; allowlist patterns; a kill plan and a runner behind injected ports with fakes only;
browser and computer use that refuse until Stage 4.3. Round 1 added one file inside the approved directory (`hiddenText.ts`,
original code, on the validator's list and judged by the credit validator) and one injected port (`PlanGatePort`); it added no
dependency and no child process API. Nothing was added to the action registry, the tenant registry, the closure authority, the
owner floor, the gatekeeper or the credential custody. Nothing in PROTECTED was touched (`git diff --stat` against the WIP commit
lists only files under `core/src/computer`, `agent/src/computer`, `core/test`, `agent/test`, this validator and this record; the
notices file, the barrel and both registration lists were not edited in this round, and `docs/06_Plan.md` is not edited). Two
things the approved row did not name were already recorded: `execDisplay.ts` and `networkPolicy.ts`.

Unbuilt, by the fix list: the registry rows and the real resolver and spawn port (Residuals). Drift: none found. The ECC
`security-reviewer` recheck (one read-only pass told to reproduce) is the next step, then one final bounded round.

ECC SECURITY and Agency `application-security-engineer` reviews were done on `f1500a7a`; this round answers them, and the recheck is requested.
