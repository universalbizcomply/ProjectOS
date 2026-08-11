# ProjectOS Operational Recovery — plan document

projectId: projectos

> **What this document is.** The owner's operational-recovery brief, transcribed into the repository
> by the implementer so that ProjectOS can read it as a planning source instead of it living only in
> a chat message. It is the INPUT to planning, and it authorises nothing on its own: no phase may
> start until ProjectOS produces a draft from it and the recorded plan-approval authority approves
> that exact draft.
>
> Owner: Murad. Gatekeeper / delegated technical authority: ChatGPT. Implementer: Claude.
> Transcribed 2026-08-11 from the owner's operational-recovery directive of the same date, extended
> the same day by the owner's product-experience addendum, and then narrowed the same day by the
> owner's scope correction: **get ProjectOS genuinely working and operable first**. The advanced
> experience layer the addendum asked for — free-flow conversational chat, voice, and automatic
> multi-AI capability routing — is recorded in the post-operational enhancement backlog below and is
> deliberately not a condition of closing this programme. The basic owner interface is NOT deferred:
> the workflow must be operable without a terminal.
>
> This is a POST-V3 programme. ProjectOS V3 is finished at 19 / 19 and is not reopened, renumbered or
> rewritten by anything here.

Vision: ProjectOS is the front door Murad actually uses to deliver software — open it, pick a project, say what the objective is, approve the plan ProjectOS proposes, and let it drive governed execution, stopping only for decisions a human genuinely has to make.

Definition of complete: the normal installed application launches and is usable; the owner selects a configured project and types a plain-language objective in the interface, with no terminal needed for normal operation; ProjectOS generates a sensible, proportional plan, takes an approval decision from the recorded authority against that exact plan and recomputes PLAN READY independently; it then starts or reconnects the governed Claude worker, hands it the correct project and phase context without a giant manual prompt, runs tests, validators, reviews and evidence collection, corrects and retests ordinary defects and carries on, and stops only for a genuine authority or protected decision; a restart preserves the correct state; and one bounded, non-production run on a real external project completes end to end — through one obvious workflow that is simple, truthful, responsive and needs no training, with no protected action taken without explicit authority and no unresolved CRITICAL or HIGH finding.

Success standard: every item of the definition of complete is proven live rather than asserted, on this machine, by evidence a reviewer can re-run — and the closed ProjectOS V3 record is still intact when it is.

## Environments

- local — production freeze: yes

## Approved scope

- Planning semantics: a broad discovery corpus, a narrow current-planning corpus, and a proposal proportional to the objective
- Trust of planning sources derived from ProjectOS-controlled location, project identity and repository identity rather than from filenames or document prose
- An exact plan-approval mechanism binding a decision to one draft, its digest, the project, the repository, the branch and the base commit
- A new post-V3 recovery plan identity, activated only by a valid approval, with PLAN READY independently recomputed
- The Control Centre as the owner's single front door: one canonical project inventory, truthful status, one obvious workflow, and a proven responsive layout
- Enough owner interface to run the workflow without a terminal — project, objective, plan, approval, execution, decision, evidence, completion — simple, clear, truthful and no-training-required
- The autonomous execution loop: next authorised phase, bounded worker instructions, launch or reconnect the governed Claude worker, validate, review, collect evidence, correct ordinary defects and continue
- Making the normal installed application operational through the existing Windows host and trust architecture
- One bounded, non-production acceptance run on a real external project

## Excluded scope

- Reopening, renumbering or rewriting the closed ProjectOS V3 programme
- Any production deployment, production or destructive database mutation, real email, SMS or messaging send, payment or live charge
- Raw credential access, credential rotation or secret disclosure
- Windows service installation, service identity change, ACL, registry or ProgramData trust mutation without a specific owner authorisation
- Force push, history rewrite, and merging to main or projectos-v3 before the final recovery merge gate
- Weakening packaged runtime identity, launch authority or any existing trust check in order to make the installed application run
- Building a second planning engine, a second authority subsystem, or an alternative parallel workflow
- Building a bespoke speech platform, an elaborate orchestration platform, or cloning another product's design
- Everything in the post-operational enhancement backlog below: it is wanted, it is recorded, and it is deliberately NOT a condition of closing this programme
- Advanced visual polish as a closure blocker — the interface must be usable and truthful, not beautiful

## Post-operational enhancement backlog

Owner decision of 2026-08-11: get ProjectOS genuinely working and operable FIRST, then build these
properly rather than holding a usable product hostage to them. They remain wanted. They are not
deleted, not forgotten, and not conditions of operational-recovery closure — each becomes a candidate
objective for its own plan once this programme is closed.

- ChatGPT-style free-flow conversational chat as the owner front door
- Long-running conversational memory and context beyond what core operation needs
- Voice commands, and two-way voice conversation
- Automatic multi-AI and multi-model capability switching, and the capability router behind it
- Proving two or more AI workers selected for different capability needs
- Advanced UI animation and motion polish
- Deeper Lovable- and Genspark-inspired experience work
- Additional premium interface refinement

## Phases

### PROJECTOS-RECOVERY-PLANNING-BRAIN1A — Planning brain recovery

Purpose: Make ProjectOS produce a plan proposal a person can read, by fixing the planning semantics rather than by editing the output.
Scope: The plan discovery and import engine, its planning-corpus roles, and the trust rules that decide which documents may shape a plan.
Depends on:
Risk: medium
Autonomy: local-safe
Browser proof: no
Acceptance criteria:
- Discovery stays broad and every discovered source keeps its authority, provenance and evidence; the record and the CLI report the whole corpus, so narrowing what may shape a plan never hides what was found
- Only current-planning material produces phase candidates, material conflicts and owner decisions; history, supporting context and quarantined material do not
- Which documents are current planning is decided by evidence the project declares, never by directory name blacklists
- A document merely named like a project config cannot make another document authoritative, and identity silence does not count as identity agreement
- The proposal generated from the real owner objective is proportionate, traceable and honest, with no historical conflict explosion and no artificial phase explosion
- Adversarial regressions exist for every fix and are mutation-proven
Required validators: validate-plan-discovery-import
Required reviews: code-review, security-review
Owner gates: commit, push, phase-closure

### PROJECTOS-RECOVERY-PLAN-AUTHORITY1A — Exact plan approval and the authority boundary

Purpose: Let a specific generated draft — and nothing else — become an approved post-V3 plan with execution authority.
Scope: The smallest safe extension of the existing approval machinery; a new post-V3 plan identity; activation of that plan.
Depends on: PROJECTOS-RECOVERY-PLANNING-BRAIN1A
Risk: high
Autonomy: local-safe
Browser proof: no
Acceptance criteria:
- An approval binds draft id, draft digest, project id, repository, branch, base commit and plan content, and is rechecked against the repository as it is at approval time
- A changed draft, a moved repository state, a different project or a different repository each invalidate the approval and fail closed
- The implementer cannot approve; submitting an objective cannot approve; generating a draft cannot approve; a filename cannot approve; prose saying approved cannot approve
- Approval produces a NEW post-V3 plan record and leaves projectos-v3.plan.json untouched
- PLAN READY is recomputed independently by the existing evaluator, never copied from a stored status string
Required validators: validate-projectos-recovery-plan-authority1a
Required reviews: code-review, security-review
Owner gates: commit, push, phase-closure

### PROJECTOS-RECOVERY-CONTROL-CENTRE1A — The owner front door: one obvious workflow

Purpose: Make normal ProjectOS operation possible without a terminal, through one obvious workflow the owner can follow without training.
Scope: Owner-facing surfaces, project inventory, objective entry, status truth, navigation and responsive layout.
Depends on: PROJECTOS-RECOVERY-PLAN-AUTHORITY1A
Risk: medium
Autonomy: local-safe
Browser proof: yes
Acceptance criteria:
- One canonical project inventory drawn from ProjectOS configuration and state, with no hard-coded project seed and no separate Owner Chat project universe; any synthetic data is unmistakably separated from real operational state
- The owner selects a configured project and types a plain-language objective in the interface, and ProjectOS generates the plan from it — no terminal is required for normal operation
- Every owner-facing status is derived from canonical runtime truth, with no stale phase counts, no fixture state presented as live, and no contradictory next action
- The owner surface answers which project, what objective, what is happening, whether the worker is working, what passed, what failed, what needs the owner, what happens next, whether anything touches production, and whether the work is finished
- Navigation presents one obvious workflow — project, objective, plan, approval, execution, decisions, evidence, completion — and surfaces that are not primary are merged, disclosed progressively or made reference material, without deleting useful capability
- The workflow is live-proven at approximately 320, 390, 768, 1280 and 1440+ with no cutoff, no hidden control, no broken scrolling, keyboard operability and valid basic accessibility, using headed or native proof
- Simple, clear and truthful is the bar. Visual polish beyond that is explicitly not required to close this phase
Required validators: validate-all
Required reviews: code-review, security-review, a11y-review
Owner gates: commit, push, phase-closure

### PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A — Close the autonomous execution loop

Purpose: After an approved PLAN READY plan, let ProjectOS run ordinary phases end to end with the governed Claude worker and without manual prompt relay.
Scope: Phase selection, worker instruction generation, session launch and reconnection, validation, review, evidence collection and ordinary-defect recovery.
Depends on: PROJECTOS-RECOVERY-PLAN-AUTHORITY1A
Risk: high
Autonomy: gated-execution
Browser proof: no
Acceptance criteria:
- ProjectOS determines the next authorised phase, verifies project, repository, branch and state, and creates bounded worker instructions from the approved plan
- ProjectOS starts or reconnects the governed Claude worker and transfers the correct project and phase context automatically; no giant manual prompt relay is required for an ordinary phase
- The worker seam is written so that adding another authorised worker later is a configuration change rather than a rewrite, but only the Claude worker is required to close this phase
- Validators, tests and reviews run automatically, and diffs, changed files and browser or native proof are collected as evidence
- An ordinary defect — a failing test, typecheck, lint, browser finding or LOW/MEDIUM review issue — is corrected and retested automatically and execution continues
- Execution stops only for a material scope decision, an unresolved CRITICAL or HIGH finding, a protected effect, an authority decision, or final merge and closure
Required validators: validate-all
Required reviews: code-review, security-review
Owner gates: commit, push, phase-closure

### PROJECTOS-RECOVERY-INSTALLED-APP1A — Make the installed application operational

Purpose: Let the normal installed application do the whole workflow, using the existing Windows host and trust architecture.
Scope: Packaged runtime identity and the smallest safe completion path for it.
Depends on: PROJECTOS-RECOVERY-CONTROL-CENTRE1A, PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A
Risk: high
Autonomy: gated-execution
Browser proof: yes
Acceptance criteria:
- The application launches from the Start Menu, reports a live runtime, opens the correct project, and accepts an objective, a plan and approved execution with no terminal
- The installed application supports the same owner workflow as development, securely, with no capability quietly dropped in the packaged build
- A restart recovers the correct state
- No security property is weakened to achieve it: no packaged-to-development fallback, no debug build presented as packaged, no trust in an arbitrary bridge configuration, identity checks remain enforced and launch authority remains enforced
- Any protected machine change required to finish is stopped and returned to the owner as a specific authorisation request rather than performed
Required validators: validate-all
Required reviews: code-review, security-review
Owner gates: commit, push, phase-closure, installation-authority

### PROJECTOS-RECOVERY-EXTERNAL-PROJECT1A — One real external project run

Purpose: Prove the recovered system on a real project that is not ProjectOS itself.
Scope: One small, bounded, non-production task in an already configured project.
Depends on: PROJECTOS-RECOVERY-INSTALLED-APP1A
Risk: high
Autonomy: gated-execution
Browser proof: yes
Acceptance criteria:
- The owner selects a real project and types the objective in the interface, and ProjectOS reads that real repository and drafts a plan for it
- The delegated authority approves the plan, PLAN READY is recomputed, ProjectOS starts the governed worker, and the bounded work completes with automatic validation and evidence
- Ordinary defects are recovered automatically; the gatekeeper reviews and closure follows
- Restarting ProjectOS afterwards recovers state correctly
- No wrong repository, no cross-project state, no giant human prompt, no hidden production action and no hand-edited plan
Required validators: validate-all
Required reviews: code-review, security-review
Owner gates: commit, push, phase-closure
