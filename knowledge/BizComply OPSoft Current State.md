# BizComply / OPSoft — Current State

> Current-state summary for the BizComply/OPSoft project, for ProjectOS Project Knowledge.
> Limited source material available for this phase. Unknowns marked clearly.

## Project identity

- **Name:** BizComply / OPSoft
- **Current version / line:** **BizComply V2** (confirmed by owner, 2026-06-30).
- **Type:** Multi-tenant, SaaS-style operational / compliance platform.

## Repo / domain if known

- **NEEDS SOURCE** — repo and domain not supplied for this phase.

## Stack if known

- **NOT VERIFIED** — stack not supplied for this phase. `NEEDS SOURCE`.

## Multi-tenant / security / RLS sensitivity

- Multi-tenant: tenant isolation is **critical**.
- Role / security / RLS / production deploy must be treated as **high-risk gates**.
- ProjectOS rules should require **strict database/security review** for:
  - tenant access changes
  - role changes
  - RLS policy changes
  - production deploys

## Production status

- **NEEDS SOURCE** — current production / deployment status not supplied for this phase.

## Recent closed phases

- **NEEDS SOURCE** — no closed-phase history supplied. Do not assume any phase closed.

## Current carry-forward queue

- **NEEDS SOURCE** — no carry-forward items supplied for this phase.

## Known risks / blockers

- Multi-tenant data isolation: any RLS / role error risks cross-tenant data exposure.
- Production deploys and security/role changes are high-risk.
- Detailed risk register: **NEEDS SOURCE**.

## ProjectOS installation considerations

- Require strict database/security review for tenant access, role changes, RLS policies and production deploys.
- No production deploy and no production DB mutation without explicit owner approval.
- Security-reviewer-style review should be mandatory before any tenant/role/RLS change.
- Install a project-local `.projectops` folder only after owner/advisor approval and a confirmed read-only source path.

## Source confidence notes

- Platform nature (multi-tenant SaaS-style operational/compliance) and the high-risk gate / strict-review requirement: supplied as confirmed facts in the phase brief.
- Everything else (repo, domain, stack, phase history, carry-forward, production status): not supplied — marked `NEEDS SOURCE` / `NOT VERIFIED`.
- No commit hashes, deployment status or phase status fabricated.

## Source discipline

- **Confirmed from owner/project memory:** BizComply/OPSoft is a multi-tenant SaaS-style operational/compliance platform; current version line is **BizComply V2** (owner-confirmed 2026-06-30); role/security/RLS/production deploy are high-risk gates; ProjectOS must require strict database/security review for tenant access, role changes, RLS policies and production deploys.
- **Confirmed from local repo docs:** None (no product repo scanned).
- **Not verified:** Repo; domain; stack; production status; phase history.
- **Needs source:** Repo/domain; stack details; closed-phase history; carry-forward queue; risk register.
