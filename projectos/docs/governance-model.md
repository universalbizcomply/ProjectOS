# ProjectOS Governance Model

## Roles
- **Murad** — owner, commercial decision-maker, final approver.
- **ChatGPT** — consultant, reviewer, decision-maker, prompt-maker, governance layer.
- **Claude** — implementer, tester, reporter, script runner.

Claude is **not** the owner, **not** the approver, **not** the closure authority.

## Authority boundaries
- Claude may: create local files, run local validators, produce evidence, recommend next steps.
- Claude may not: approve closure, deploy, mutate databases, send real messages, touch payments,
  use secrets, add remotes, push, or start an unapproved phase.

## Decision flow
1. ChatGPT drafts a phase prompt (scope, allowed/forbidden, validators, evidence).
2. Murad approves the prompt.
3. Claude implements locally and validates.
4. Claude files an evidence pack and stops for review.
5. Murad/ChatGPT review and decide closure.

Automation collects facts, runs checks and generates reports. It does not make owner decisions.