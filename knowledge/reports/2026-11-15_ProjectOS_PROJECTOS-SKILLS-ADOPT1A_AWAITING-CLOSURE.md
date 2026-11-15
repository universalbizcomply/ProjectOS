# PROJECTOS-SKILLS-ADOPT1A — awaiting closure

**Phase:** PROJECTOS-SKILLS-ADOPT1A, phase 45 of 47 of plan v1.36
**Closure route:** owner-direct, under the owner's full-authority grant. No gatekeeper closure ruling was obtained, and none is claimed.

V4 Stage 3, plan 3.2. A skill's origin is minted only by the kernel (two doors, one owner-only; a string, copy, spread or request field is refused). Promotion needs the skill validator, an independent review answered true by an injected verifier over a frozen claim bound to tenant, project, skill, package hash and proposal hash, and a hash pin; the queue records every minted proposal in installation state so a forged proposal file is refused. The loader reads promoted records from committed bytes at HEAD only, refuses an unpinned, changed, foreign-project or stale record, asks the verifier again at load before any validation work, and adds a skill to the context file after every decision as fenced, authority-none data; nothing in scripts/ is read or run. The bounded-repeat guard evasions are closed (sed per-line, long path before .env). In production no skill loads yet because no review verifier exists: committed skills are withheld by code with a named fix.

Full record: `docs/finish/PROJECTOS-SKILLS-ADOPT1A.md`.
