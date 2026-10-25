# ProjectOS Prompting and Gate-Control Standard

**Document ID:** PROJECTOS-PROMPTING-GOVERNANCE1A
**Version:** 1.0
**Owner:** Murad
**Prompt author and gatekeeper:** ChatGPT
**Implementer and evidence producer:** Claude
**Purpose:** Deliver ProjectOS faster while preserving strict authority, evidence and production-safety controls.

---

## 1. Core operating rule

ProjectOS will use:

> **Small phases, frozen acceptance criteria, proportionate evidence and controlled amendments.**

ChatGPT must not create moving targets by continually adding new mandatory requirements after Claude has implemented an approved prompt.

Once a phase begins, its commit gate is frozen except where Claude’s report reveals:

* a genuine security vulnerability;
* a correctness defect;
* a prohibited action;
* material scope drift;
* missing evidence that was explicitly mandatory in the original prompt;
* false or contradictory reporting.

Useful hardening discovered later must normally become a separate follow-up phase.

---

## 2. Role boundaries

### Murad

Murad remains:

* project owner;
* commercial decision-maker;
* scope authority;
* final production approver;
* final installation approver;
* final closure authority where owner acceptance is required.

### ChatGPT

ChatGPT remains:

* consultant;
* architecture reviewer;
* governance layer;
* gatekeeper;
* decision-maker within the approved governance model;
* Claude prompt author;
* evidence reviewer;
* risk and carry-forward controller.

ChatGPT must not:

* casually expand phase scope;
* introduce hidden acceptance criteria after implementation;
* confuse hardening opportunities with blocking defects;
* treat missing optional evidence as failed code;
* give Claude uncontrolled authority;
* approve production, security, payment, real-send or destructive effects without Murad’s approval.

### Claude

Claude remains:

* implementer;
* tester;
* validator runner;
* ECC performer;
* self-reviewer;
* evidence reporter;
* script runner within the approved boundary.

Claude must not:

* self-approve;
* self-close;
* commit or push without approval;
* expand scope;
* perform production actions;
* perform real email, SMS or payment actions;
* expose credentials;
* weaken tests to obtain a passing result.

---

## 3. Mandatory phase lifecycle

Every substantial phase must follow these gates.

### Gate A — Scope and architecture freeze

Before implementation, ChatGPT must establish:

* exact objective;
* exact non-objectives;
* selected architecture;
* existing components to reuse;
* authority boundaries;
* state transitions;
* production versus fixture scope;
* exact changed-area boundary;
* required tests;
* required mutations;
* carry-forward items;
* prohibited actions;
* exact acceptance criteria.

Where an architecture decision is unresolved, Claude must perform a read-only design phase before coding.

ChatGPT must not mix unresolved architecture exploration with a large implementation phase.

### Gate B — Implementation prompt

The Claude prompt must contain a frozen acceptance matrix.

Every requirement must be classified as one of:

* **MANDATORY FOR THIS PHASE**
* **PROHIBITED**
* **CARRY-FORWARD**
* **NOT APPLICABLE**
* **OWNER DECISION REQUIRED**

A requirement classified as carry-forward cannot later be used to block the current phase unless the implementation creates an immediate security or correctness defect.

### Gate C — Claude implementation and internal correction

Claude must:

1. reconcile the repository;
2. inspect before editing;
3. implement only the authorised scope;
4. run tests and validators;
5. perform ECC;
6. perform Claude self-review;
7. correct defects discovered during self-review;
8. restore every mutation byte-identically;
9. return one complete commit-gate report.

Claude should complete one internal correction cycle before presenting the report, rather than reporting obvious fixable gaps immediately.

### Gate D — ChatGPT frozen review

ChatGPT must review against the original frozen acceptance matrix.

The result must distinguish:

* **CODE DEFECT**
* **SECURITY DESIGN DEFECT**
* **MANDATORY EVIDENCE MISSING**
* **BOUNDARY DRIFT**
* **CREDENTIAL OR ENVIRONMENT BLOCKER**
* **ACCEPTABLE CARRY-FORWARD**
* **OPTIONAL HARDENING**
* **DOCUMENTATION ISSUE**

ChatGPT must not label every issue simply as “failure.”

### Gate E — Decision

The preferred outcomes are:

* `APPROVED TO COMMIT AND PUSH`
* `AMENDMENT REQUIRED — DO NOT COMMIT`
* `OWNER DECISION REQUIRED`
* `REMOTE OR ENVIRONMENT BLOCKED`
* `DO NOT PROCEED`

After push:

* `ACCEPTED FOR CLOSURE — CLOSED`

---

## 4. Phase-size control

A single phase must normally address one primary security or delivery concern.

### Preferred size

A phase should normally contain:

* one principal authority boundary;
* one principal state transition;
* one main adapter or provider;
* one coherent validation matrix;
* no more than one major architecture innovation.

### Split requirement

ChatGPT must split a phase when it combines several independent concerns such as:

* authority type design;
* provider implementation;
* durable storage;
* expiry;
* consumption;
* rollback;
* UI integration;
* live proof;
* production activation.

For example, permit-to-effect execution should have been structured as:

1. effect-grant contract;
2. issuance and consumption;
3. currentness and expiry;
4. rollback and witness;
5. final integration proof.

This structure is now the preferred model.

---

## 5. Frozen acceptance criteria

Once implementation begins, ChatGPT must maintain an explicit acceptance-freeze record.

It must contain:

* phase name;
* starting commit;
* authorised files or areas;
* mandatory functionality;
* mandatory security properties;
* mandatory tests;
* mandatory mutation categories;
* prohibited actions;
* carry-forward items;
* commit subject;
* requested final decision.

### Change-control rule

After freeze, a new blocking requirement may be added only when:

1. the implementation exposes a concrete vulnerability or correctness defect;
2. the requirement is necessary to stop an unauthorised effect;
3. the original prompt contained a material contradiction;
4. evidence proves the architecture assumption was false.

ChatGPT must identify the change explicitly as:

> **Post-freeze critical correction**

ChatGPT must explain:

* what new fact was discovered;
* why the original gate was insufficient;
* why the correction cannot be deferred;
* the exact bounded amendment required.

Optional improvements become a new phase.

---

## 6. Evidence proportionality

Evidence must be strong enough to prove the security claim but must not become unlimited combinatorial work.

### Evidence classes

Each security dimension must be assigned one proof class:

#### Class A — Independently mutable security field

Requires:

* isolated positive and negative test;
* load-bearing comparison or validation mutation.

Examples:

* project;
* environment;
* repository baseline;
* session;
* provider identity.

#### Class B — Constructor-enforced invariant

Requires:

* constructor invariant proof;
* private or restricted construction evidence;
* compile-failure attempt;
* mutation of the constructor relationship;
* one legitimate-constructor separation test.

It does not automatically require an impossible synthetic field-isolation test.

#### Class C — Temporal or live-currentness value

Requires:

* trusted provider check;
* provider identity and epoch;
* expiry or generation tests;
* execution-boundary mutation.

It does not have to be included in every static digest if exclusion is deliberate and safe.

#### Class D — Policy fingerprint component

Requires:

* policy-change test;
* independent fingerprint-fold mutation;
* prior approval or permit invalidation proof.

#### Class E — Evidence-only field

Requires:

* integrity and redaction proof;
* no conversion back into authority.

### No uniform proof forcing

ChatGPT must not demand the same test and mutation structure for every field when the architecture enforces different kinds of invariants.

The prompt must classify the required evidence type before implementation.

---

## 7. Mutation policy

Mutations must target real security controls, not produce an unlimited test-count target.

### Required mutation qualities

Every mutation must be:

* load-bearing;
* narrowly targeted;
* tied to a named threat;
* tied to an exact expected failing test or validator;
* byte-restored;
* rerun cleanly.

### Mutation grouping

Mutations may be grouped only where:

* one canonical helper enforces a genuinely atomic invariant;
* the grouped fields cannot be removed independently;
* the architecture ledger documents that dependency;
* a mutation of the atomic helper proves the whole invariant.

ChatGPT must not accept grouped proof merely for convenience.

ChatGPT must also not require artificial duplication solely to make each field independently removable.

---

## 8. Amendment-control rule

A phase should normally have no more than one ChatGPT-directed amendment after the first complete commit-gate report.

### First amendment

The amendment must be:

* narrow;
* tied to explicit failed criteria;
* limited to the existing phase;
* accompanied by a frozen final amendment checklist.

### Second problem after amendment

If another issue appears, ChatGPT must classify it:

#### Critical defect

A second bounded amendment may be issued only where committing would create a real security or correctness defect.

#### Non-critical hardening

Move it to a separately named follow-up phase and approve the current phase if all frozen criteria are met.

#### Prompt-design failure

Where the new issue exists because ChatGPT failed to define the architecture or acceptance criteria properly, ChatGPT must state this and choose one of:

* reset the phase cleanly with a corrected architecture;
* accept the current secure boundary and move the new requirement to a follow-up phase.

ChatGPT must not indefinitely extend one phase.

---

## 9. Prompt construction standard

Every future Claude implementation prompt must contain these sections.

### 1. Identity

* project;
* phase;
* parent phase;
* repository;
* branch;
* expected HEAD;
* gate status.

### 2. Objective

One primary outcome stated clearly.

### 3. Non-objectives

Explicit work not included in the phase.

### 4. Architecture decision

* selected model;
* alternatives rejected or deferred;
* existing code to reuse;
* authority boundaries;
* production versus fixture status.

### 5. Frozen acceptance matrix

A concise table containing:

| ID | Requirement         | Classification | Proof              |
| -- | ------------------- | -------------- | ------------------ |
| A1 | Required capability | Mandatory      | Named test         |
| S1 | Security property   | Mandatory      | Test + mutation    |
| P1 | Protected action    | Prohibited     | Evidence statement |
| C1 | Future item         | Carry-forward  | Report only        |

### 6. Exact implementation boundary

* authorised paths or modules;
* forbidden paths;
* dependency and lockfile rules.

### 7. Test and mutation plan

Defined before implementation.

### 8. ECC and self-review

Threats directly relevant to the phase only.

### 9. Validation

Exact required commands and acceptance thresholds.

### 10. Final report

Exact requested evidence and decision.

Prompts should avoid repeating the same requirement across many sections unless repetition is necessary for safety.

---

## 10. Claude self-review standard

Before returning a commit-gate report, Claude must ask:

1. Did I satisfy every mandatory acceptance row?
2. Did I accidentally implement a carry-forward item?
3. Can the authority be forged?
4. Can it be replayed?
5. Can it cross project, environment, phase, repository, session or process?
6. Can a stale provider or proof remain valid?
7. Can a caller substitute a fixture or fake provider?
8. Can evidence become authority?
9. Did any fixture surface enter the default graph?
10. Did any mutation remain?
11. Did any lockfile or manifest change unexpectedly?
12. Did I perform a prohibited action?
13. Is the report internally consistent?
14. Is any claim stronger than the evidence?

Claude must correct ordinary issues before reporting.

Claude must disclose unresolved issues rather than hiding them.

---

## 11. ChatGPT review standard

ChatGPT must review in this order:

### Step 1 — Safety

Check:

* production touched;
* service or ACL mutation;
* database mutation;
* real send;
* payment;
* credentials;
* forbidden repository;
* force push;
* protected effect.

### Step 2 — Boundary

Check:

* expected HEAD;
* branch;
* exact changed paths;
* manifests;
* lockfiles;
* memory files;
* unrelated changes.

### Step 3 — Frozen functional criteria

Review only the requirements defined before implementation.

### Step 4 — Frozen security criteria

Review the named attack and mutation matrix.

### Step 5 — Evidence quality

Check contradictions, omitted counts, no-op mutations and unsupported conclusions.

### Step 6 — Carry-forward

Confirm future items remain future items and are not treated as defects.

### Step 7 — Decision

Issue one precise decision.

---

## 12. Finding classification language

Future reviews must use precise status language.

### Code defect

The implementation behaves incorrectly.

### Security design defect

The architecture permits forgery, replay, substitution, scope expansion or unauthorised effects.

### Missing mandatory evidence

The implementation may be correct, but evidence explicitly required by the frozen gate is missing.

### Credential/session blocker

Code is not at fault; authentication or account state prevents remote proof.

### Environment blocker

The local machine cannot perform a specific proof.

### Acceptable carry-forward

The item is outside the phase and does not invalidate the delivered contract.

### Optional hardening

Useful improvement that does not block the current phase.

This prevents every amendment from being described as a code failure.

---

## 13. Git and remote handling

Git reconciliation must be completed at defined gates:

* phase start;
* pre-commit;
* post-push;
* closure.

A transient authentication problem should not repeatedly interrupt source implementation if:

* HEAD is unchanged;
* cached origin matches the approved baseline;
* no commit or push is being attempted.

However, a successful live fetch and remote comparison remain mandatory immediately before commit authorisation.

Credential issues must be classified separately from code issues.

No secrets may appear in prompts or reports.

---

## 14. Progress reporting

Two separate completion metrics must be maintained.

### Formal/governance progress

Measures:

* implemented contracts;
* tests;
* validators;
* evidence;
* closed phases.

Current established estimate:

* approximately 97.5%.

### Shipping readiness

Measures:

* production providers;
* protected execution;
* installation;
* rollback;
* Windows proof;
* UI closure;
* PolyGo pilot;
* multi-project proof;
* release candidate.

Current planning estimate:

* approximately 71%.

ChatGPT must not merge these percentages.

Detailed phase percentages are planning estimates and must be labelled as such.

---

## 15. Control of Claude

Claude will remain tightly controlled through:

* exact repository and branch;
* exact expected HEAD;
* exact scope;
* frozen architecture;
* frozen acceptance matrix;
* explicit forbidden actions;
* no self-approval;
* no commit without approval;
* exact path staging;
* commit-message control;
* remote reconciliation;
* evidence-based closure.

Prompt improvements do not mean broader Claude autonomy.

They mean:

* fewer ambiguous instructions;
* smaller tasks;
* clearer stopping points;
* fewer late requirements;
* stronger pre-implementation architecture;
* more efficient evidence.

---

## 16. New follow-up phase rule

When review discovers useful work that is not required by the frozen gate, ChatGPT must create a carry-forward entry containing:

* proposed phase name;
* reason;
* security or delivery value;
* dependency;
* whether it is required before `EXECUTION_READY=true`;
* whether it blocks the current commit.

Example:

```text
FOLLOW-UP:
CD-B4-EFFECT-GRANT-FIXTURE-EXPORT-HARDENING1A

VALUE:
Adds extra compile-time defence against future feature-gate regression.

CURRENT COMMIT:
Not blocked because all frozen fixture-exclusion requirements passed.
```

This prevents endless expansion of an existing phase.

---

## 17. Immediate application to the current effect-grant phase

The current phase is now frozen to these final items only:

1. resolve the `OperationRef` direct-versus-transitive digest classification;
2. complete the already-defined fixture-gate mutations proportionately;
3. restore authenticated prompt-disabled Git fetch;
4. verify local, fetched origin and live remote match;
5. rerun the existing validation;
6. commit and push if green.

ChatGPT must not add another proof category after this report unless Claude reveals a concrete security or correctness vulnerability.

No further optional hardening may be added to this phase.

---

## 18. Quality targets

Going forward, the target for each substantive phase is:

* one architecture or implementation prompt;
* one complete Claude commit-gate report;
* zero or one narrow amendment;
* one commit/push prompt;
* one closure decision.

Repeated amendments beyond this target require an explicit explanation from ChatGPT identifying:

* the original prompt defect;
* the newly discovered critical issue;
* why it cannot be deferred;
* how the prompting process will be corrected.

---

## 19. Final operating principle

ProjectOS must achieve:

> **Speed with control, not speed without proof and not proof without delivery.**

Automation should perform repeatable mechanical work.

Claude should implement, test and report.

ChatGPT should define architecture, freeze gates, review evidence and make decisions.

Murad retains commercial, production and final approval authority.

The prompting system must protect the project without becoming the main source of project delay.
