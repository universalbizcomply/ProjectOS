# PROJECTOS-FINISH-API-GATEKEEPER1A — evidence

Phase 3 of 4 of plan v1.12. Claude (lead) implemented it directly, under the owner's grant of 2026-10-25
("I give you full authority now") and the owner's route decision of the same day ("Route 2 now"). It was
not dispatched to a governed worker, and this document claims no ChatGPT gatekeeper ruling for it.

## What changed

1. **The trusted broker answers, but only on the owner's committed opt-in.** An unattended project
   reaches the restored pre-hybrid installation broker
   (`projectos/security/gatekeeper-transport-broker.cjs`) only when `.projectops/gatekeeper.json` says
   `"route": "installation-broker"`. That value must be in BOTH the committed configuration
   (`git show HEAD:`) and the working copy (`brokerRouteOptedIn`, `run.ts`).
   - This is stricter than criterion 1's wording ("with no Host route configured"), on ECC SECURITY M2.
     Deleting a Host block must not quietly move a project from a Host-attested review to a same-user
     key.
   - Without the opt-in or a Host block, nothing is composed and the turn waits, as before.
2. **One broker composition, in the pre-hybrid shape.** The loop (`composeGatekeeper`) and closure
   (`productionClosureDeps`) use one shared `trustedBroker(sys, root, projectId)`:
   - the installation transport;
   - the governed root;
   - the installation allowlist, asked on this side first.
   
   It is composed with no `mode`, because `mode: 'unattended'` means Host-attested and the turn refuses
   that mode without a Host route. That was the round-1 ECC CODE HIGH: the broker was unreachable. Broker
   evidence carries no Host provenance stamp, so it can never pass for a Host-attested answer.
3. **Never both routes.** A committed Host block together with the opt-in is refused as
   `GATEKEEPER_ROUTE_AMBIGUOUS`, in `run` and in `closure request`. Nothing is asked and nothing is spent.
   A Host block that is present but invalid still refuses, as before.
4. **The agent never holds the key.** The resolver handed to the turn is still `unprovisionedResolver`.
   The broker resolves `OPENAI_GATEKEEPER_KEY` inside its own process, from the installation's Windows
   credential store, after checking two things:
   - the installation allowlist;
   - the phase's committed `.projectops/gates/<phase>.secrets-handling.json` receipt.
5. **Degraded-mode reconciliation composes no paid route** (`reconcile.ts` unchanged; validator AG-4).
6. **Allowlist:** a pure 6-line addition of `seo-agency` at `127.0.0.1:47900/SEOAgency-remote/seo-agency`,
   governed root `C:/dev/SEOAgency`, marked temporary. The `projectos` entry is unchanged.

The broker, the credential store adapter, the credential reference table, the resolver, the Host review
route and all Rust sources are unchanged, as the phase's exclusions require.

## Acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | Broker with no Host route; Host route when configured; invalid refuses; resolver refuses | E2E `hostReviewPath`: "NO broker opt-in, nothing is composed", "the trusted BROKER is composed in the pre-hybrid shape", "COMMITTED Host block (no opt-in) … NO broker", "refused as ambiguous"; existing invalid-Host-block refusals unchanged; resolver `resolve('OPENAI_GATEKEEPER_KEY')` refuses (asserted). The broker additionally requires the committed opt-in (see 1 above). |
| 2 | Allowlist authorises `seo-agency` only, nothing else changes | Validator AG-5 (exactly `projectos` + `seo-agency`, by id, repository and root); diff is a 6-line insertion |
| 3 | Tests prove the compositions and that no key reaches the agent; rules pinned and mutation-killed | Run side: "refused before dispatch: nothing posted, no ledger"; "reaches the broker exactly once" (recording fake `BrokeredTransport` through `runLoop`: one post bound to project, phase, root and `credentialRef`, no `sk-` in the body, agent resolver asked 0 times). Closure side: "on the broker opt-in, a project the installation does not allowlist is refused before the closure request" (no ledger, no decision, no interactive file) and the closure/reconcile shape guard. Validator section (12) AG-1..AG-6; 10/10 named mutations killed by the named rule, 7/10 also by a test |
| 4 | Live review question on the agency project answered through the broker, no relay, cost recorded | **MET, 2026-10-25, at installation HEAD `7d1343e`.** The owner stored the key at the hidden prompt (fingerprint `20f9cbfe22c5`). Then `projectos continue --execute` ran in `C:\dev\SEOAgency`: real worker, 2 attempts, `validate-site` PASS. Review `GKREQ-a4d090c3c1a82185f8b3b11a` (gpt-5.6-luna) approved continuation, with 419 micro-USD recorded in the ledger. The work was committed as `7d627d7` and the run records as `d1710c7`. Closure question `CLREQ-0b3a4b17e03c65e3b73788ed` (gpt-5.6-terra) decided close for 6,309 micro-USD. After the owner committed the decision (`357e92a`), `closure resume` closed the phase under the agency's delegation. Total spend: 6,728 micro-USD of the $5 hard stop. No owner relay. |
| 5 | Agent and core green; validate-all no new failure; ECC reviews no unresolved CRITICAL/HIGH | agent 2516/2516 (94 files); core 766/766; agent `tsc` (src and test) and core `tsc` clean; `val-projectos-boot-continue1a`, `val-projectos-trust-boundary1a`, `val-projectos-gatekeeper-contract1a` and `validate-no-secrets` PASS; `npm run typecheck:all` clean; validate-all 145/147 (the two known: `validate-desktop-e2e`, `val-cd-b4-sealed-expected-window-facts1a`); reviews below |

## Reviews

- **Round 1.**
  - ECC CODE: 1 HIGH (H1, the broker was composed with `mode: 'unattended'`, so the turn refused before
    reaching it) and mediums M1–M4 (no behavioural test, a doc comment lost, the validator not pinning
    the binding, a duplicated broker composition).
  - ECC SECURITY: M1 (route unreachable, same as H1); M2 (no explicit opt-in, so removing a Host block
    downgraded the route); M3 and M4 (the spend cap is project-side only, and the pasted key stays — both
    owner decisions); LOWs.
- **One fix round.** Pre-hybrid shape; committed opt-in in both the commit and the working copy; the
  ambiguity refusal; one shared `trustedBroker`; behavioural tests; validator AG-1..AG-6 rewritten; doc
  comments restored.
- **Round 2.**
  - ECC CODE: APPROVE, 0 CRITICAL, 0 HIGH, 1 MEDIUM, 6 LOW.
  - ECC SECURITY: no CRITICAL or HIGH.
  - Both asked for a closure-side behavioural test (CODE MEDIUM-1, SECURITY A1). It is added: an opted-in
    world whose project the installation does not allowlist is refused before any closure request. A
    new named mutation, A10 (the closure broker composed in Host-attested mode), is killed by that test
    and by AG-3.
  - The LOW tidy-ups are applied: an orphaned doc comment, duplicate imports, and a stale comment in
    `run()`.

## Carried forward, each with its trigger

- **Live proof** (criterion 4). Trigger: the owner stores the key. It is then run and reported with
  EXTERNAL-PROOF1A.
- **Provider-side spend cap** (SECURITY M3/M4). The $5 hard stop is enforced by ProjectOS's own ledger.
  Owner action: set a monthly budget on the OpenAI project that holds the key. The owner has deferred
  key rotation: "If any credential or token rotation is required, it will be completed after ProjectOS
  project completion."
- **Provenance class** (SECURITY A2). A broker answer shows to the owner as `unrecorded`, not as a named
  class. It can never pass as Host-attested. A distinct "installation broker" provenance belongs in core,
  which is outside this phase's paths.
- **Implicit route discriminator** (SECURITY A3). The deps shape (no `mode`) selects the broker branch,
  and AG-1 and AG-3 pin it. An explicit `route` field on the turn deps type would be sturdier, but that
  type is outside this phase's paths.
- **Closure test with Host block + opt-in** (SECURITY A1, second half). The closure-side ambiguity
  refusal is pinned by AG-3 and mutation A7, without a behavioural test.
- **Carried, agreed with the reviewers:** closure funding text; broker error-body redaction; the agency's
  forbidden-actions wording; stale comments in `hostReviewComposition.ts`, `gatekeeperTurn.ts` and
  `reconcile.ts`, all outside this phase's paths.
- **The allowlist entry is temporary.** Remove `seo-agency` when the owner retires the agency proof or
  activates Host credential custody (decision C5).

## Verification commands

    npx vitest run                         (projectos/agent, projectos/core)
    npx tsc --noEmit -p tsconfig.json; npx tsc --noEmit -p tsconfig.test.json   (projectos/agent)
    node projectos/validators/val-projectos-boot-continue1a.cjs
    node projectos/validators/val-projectos-trust-boundary1a.cjs
    node projectos/validators/val-projectos-gatekeeper-contract1a.cjs
    node projectos/validators/validate-no-secrets.cjs
    node projectos/validators/validate-all.cjs
    node C:/dev/ProjectOS-candidate-backups/finish-api-gatekeeper1a/tools/mutation_battery.cjs --behaviour
