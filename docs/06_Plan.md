# 06 — Implementation Plan (living checklist)

**Rules:**
- Work top to bottom.
- Tick a box only when its check passed.
- Update this file after every completed step: the date, the commit, and one line of evidence.
- Items marked **[OWNER]** are protected actions or scope decisions and wait for the owner.
- Items marked **[APPROVED: delta]** are covered by `docs/changes/delta_spec.md` once the owner
  approves it.

**Done so far:** plans v1.9 to v1.15 are complete. The core runtime, gatekeeper broker, zero-touch
closure and one-continue closure are built and live-proven on the agency project (`2baff14`).

## Phase 1 — Data and authentication

- [ ] 1.1 **[OWNER]** Revoke the pasted OpenAI key at platform.openai.com. This is due at ProjectOS
      completion, by the owner's own statement.
- [ ] 1.2 **[OWNER]** Delete the stored credential:
      `npm run credentials -- delete --ref ProjectOS/projectos/development/openai/gatekeeper-api-key`.
      Optionally store a new key and set a provider-side spend cap.
- [ ] 1.3 **[APPROVED: delta]** Retire the temporary `seo-agency` entry from
      `projectos/security/installation-project-allowlist.json`, and update validator AG-5 to match.
- [ ] 1.4 **[APPROVED: delta]** In the agency repo, set `.projectops/gatekeeper.json` `enabled: false`
      until a new key is stored.
- [ ] 1.5 **[OWNER]** Supabase RLS: bind `public.projects` and `public.phases` policies to the owner's
      `auth.uid()`, or confirm that sign-up is closed (baseline risk §5.1).
- [ ] 1.6 **[OWNER]** Decide on signed commits for authority paths (`.projectops/authority`, `gates`,
      `plan-decisions`).

## Phase 2 — Core runtime

- [ ] 2.1 **[OWNER: scope]** D11: an independent code and security reviewer inside the loop, recorded
      before the gatekeeper is asked. Today, a plan with only a worker self-review lets partial work
      close.
- [ ] 2.2 Reword the run loop's "STOPPED (OWNER_DECISION_REQUIRED) … closure is never continued
      through" line when the closure route will carry on (EXTERNAL-PROOF3A).
- [ ] 2.3 Record the broker as a positive provenance class, with its response id (D9).
- [ ] 2.4 Make `continue --dry-run` write no execution briefs (D5).
- [ ] 2.5 Give receipts a machine-readable scope, and remove the hard-coded "did not when it was
      written" line (D3).

## Phase 3 — UI integration (Control Center)

- [ ] 3.1 Define or remove the undefined CSS variables (`--os-accent`, `--os-line`, `--os-ink`,
      `--os-ink-dim`, `--os-inset`, `--os-mono`, `--warn-ink`).
- [ ] 3.2 Move hard-coded dark colours in older screens onto tokens; dedupe `.ocp-btn`; style
      `os-primary`.
- [ ] 3.3 Update `projectos/control-center/README.md` to the current view list.
- [ ] 3.4 **[OWNER]** Set a Tauri CSP (currently `null`).

## Phase 4 — Edge cases and tests

- [ ] 4.1 Register or retire the six unregistered validators (baseline §5.3).
- [ ] 4.2 Add an `engines` field (Node 24) and a `rust-toolchain.toml` (1.96.1).
- [ ] 4.3 Agency follow-up phase: close the residual `validate-site` bypasses, with independent review
      declared in its plan (EXTERNAL-PROOF3A D11).
- [ ] 4.4 Pin the clean-tree condition inside `closurePrepared` on its own (CONTINUE-INTEGRITY1A
      carry-forward).

## Log

- 2026-10-28: context architecture written (00 to 06, delta spec). No application code changed.
