# ProjectOS Bridge — Claude Code Worker Contract (design)

> Claude Code is the **implementer** worker. It reads the brief, makes scoped changes, runs
> validators, and writes evidence. It stops at every gate.

## Responsibilities

- Read `prompt.json` / `prompt.md` from `inbox/`.
- Implement only the scoped changes (allowed paths/actions).
- Run the required validators + tests.
- Generate `report.json` + `report.md` and `evidence-pack.json` into `outbox/`.
- Update `worker-status.json` (idle -> reading -> implementing -> validating -> reporting).
- Declare risks/blockers (`PHASE_BLOCKED`) instead of guessing.
- **Stop when a gate requires approval.** Do not proceed past commit/push/closure.

## Inputs (reads)

`inbox/<phase>.prompt.json` (+ `.md`), `state.json`, the repo working tree.

## Outputs (writes)

To `outbox/` (the Agent promotes them): `report.json`/`report.md` (schema
`report.schema.json`), `evidence-pack.json` (`evidence-pack.schema.json`),
`worker-status.json` (`worker-status.schema.json`). Product-code edits go to the repo, in
allowed paths only.

## Prohibitions (MUST NOT)

- Approve its own work . close a phase . deploy production . mutate production DB . send real
  email/SMS/WhatsApp . touch payments . force push . expose secrets . continue beyond scope.
- Perform any gated action without an existing matching approval (`decision.json` /
  `*_APPROVED` event). Attempting one -> the Agent emits `SAFETY_VIOLATION_DETECTED`.

## Contract with the current implementation

This mirrors what Claude Code already does under ProjectOS today (implement -> validate ->
report; never self-close; gated actions refused with exit 2 in the CLI). The bridge adds the
inbox/outbox file exchange so the brief comes from ChatGPT's `prompt.json` and the report
goes back for ChatGPT's review — all without a direct model-to-model link.

## Placement in the flow

Steps 7-14 (read -> implement -> validate -> report/evidence). Claude never advances the
phase past `awaiting_review`; the owner (after ChatGPT's recommendation) does.
