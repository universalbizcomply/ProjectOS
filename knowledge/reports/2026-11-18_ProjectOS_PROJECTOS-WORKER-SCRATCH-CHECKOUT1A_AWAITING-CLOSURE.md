# PROJECTOS-WORKER-SCRATCH-CHECKOUT1A — awaiting closure

**Phase:** PROJECTOS-WORKER-SCRATCH-CHECKOUT1A, phase 52 of 55 of plan v1.42
**Closure route:** owner-direct, under the owner's full-authority grant. No gatekeeper closure ruling was obtained, and none is claimed.

Stage 4 plan 4.3a. The Codex implementer used to run in the governed checkout and only detect writes outside its grants afterwards. It now runs in a scratch copy (a fresh temporary directory, never .git, never an ignored file) and only changes inside the write grants are copied back; anything else refuses the whole copy-back and the real tree is byte-identical after a refusal. The before and after snapshot of the real root stays as the backstop. Closes residuals 3, 4 and 5 of the implementer record; residual 2 (reads by absolute path) stays open and D4 is not retired. 8.3 short names, case, hard links and device names are refused in a copy-back. No live Codex run.

Full record: `docs/finish/PROJECTOS-WORKER-SCRATCH-CHECKOUT1A.md`.
