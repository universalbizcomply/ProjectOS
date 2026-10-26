# PROJECTOS-FINISH-EXTERNAL-PROOF1A — evidence

Phase 4 of 4 of plan v1.12. This phase proves ProjectOS on a real new project. The owner chose the
project on 2026-10-25: "No Dead Aisle, instead, I want you to create a SEO, Social Media Posting
agency". The owner's further choices were "Agency website", "No, agency only", "New local repo only" and
"Keep everything inert". Claude (lead) set the project up on the owner's grant of 2026-10-25 ("I give
you full authority now"). The agency's own phase was carried by ProjectOS: a governed worker, the ChatGPT
gatekeeper through the trusted broker, and ChatGPT as closure authority.

## Objective

Create a governed local repository for an SEO and social-media posting agency, seeded with three
open-source toolkits, with every posting path disabled. Approve its first plan, carry one ordinary phase
(the agency's marketing website) through `projectos continue` end to end, and count the owner's acts.

## The agency project (criterion 1)

- **Repository:** `C:/dev/SEOAgency`, project id `seo-agency`, branch `work`.
  - **Remote:** a local bare repository, `C:/dev/SEOAgency-git/SEOAgency-remote/seo-agency.git`. It is
    served only on `127.0.0.1:47900` by a localhost git HTTP backend (`githttp.cjs`); D4 explains why it
    is not a plain path. Since 2026-10-26 the remote refuses non-fast-forward pushes and branch deletes.
  - There is no GitHub repository, domain or deployment.
- **Vendored toolkits:** all three are MIT-licensed, vendored at pinned commits, with their licences in
  `THIRD_PARTY_LICENSES/`. The 2026-10-25 supply-chain review is in `VENDORING.md`; it found no malware,
  credential theft or telemetry.

  | Folder | Upstream | Commit | Status |
  |---|---|---|---|
  | `vendor/geo-seo-claude` | zubair-trabzada/geo-seo-claude | `989cae01e8eb` | **Hardened**, see below |
  | `vendor/instagram-agent-skill` | Jakeschincariol/instagram-agent-skill | `d03c56bb598b` | **As-is.** Never posts; its skills end in copy-ready text for a person to publish. `/ig-viral` suggests driving a logged-in browser, and some skills read and write `~/.claude/instagram/` |
  | `vendor/autosocial` | katzca/autosocial | `6deb560ee58e` | **INERT** (`vendor/autosocial/INERT.md`). Never installed, configured or run. The review records that it is built for automated cross-platform re-posting, terms-of-service evasion and a posting dashboard |

  - **geo-seo-claude hardening:**
    - no skill pre-grants `Bash`;
    - no brand name is spliced into an inline `python3 -c`;
    - the Python page fetchers go through `net_guard.safe_get`, which refuses private, loopback and
      link-local addresses at every redirect.
  - **Limits of the hardening:** `net_guard` is compiled but not exercised, because `requests` is not
    installed. It does not cover the skills' pre-granted `WebFetch`.
  - **Inert by policy only:** autosocial's `package.json`, `download_tiktok.bat` and `.env.example`
    (`AUTO_POST_PLATFORMS`) are still runnable. Nothing is installed in `~/.claude` or anywhere else, and
    no toolkit has credentials, a session or a posting schedule.
- **Governance:** `.projectops/` is installed. The agency's check is
  `projectos/validators/validate-site.cjs`, which runs under ProjectOS on Windows and PASSes on the built
  site.
  - It was exercised by an off-tree harness: one good fixture plus one targeted breakage per rule,
    13/13 as expected, re-run on 2026-10-26. The harness is kept at
    `C:/dev/ProjectOS-candidate-backups/finish-external-proof1a/test-validate-site.cjs`.
  - Its script rule checks only `<script src>`; see the security review.
- **First plan:** `plan/seo-agency-phases.json` holds one phase, SEO-AGENCY-WEBSITE1A, with writePaths
  `site/` and required validator `validate-site`.
  - The owner approved it in this conversation ("Approve").
  - Claude transcribed that into PLANDEC `a1e9038` and genesis activation `380ab72`, with the delegation
    in `authority/closure-delegation.json`. Each record says Claude wrote its bytes.

## The live run (criterion 2), reported separately from synthetic tests

**Setup:**
- **Installation:** ProjectOS `7d1343e` (API-GATEKEEPER1A), with the agent rebuilt from that commit.
- **Gatekeeper:** unattended, through the trusted installation broker (`"route": "installation-broker"`,
  agency `b3990d4`), funded by the phase's secrets-handling receipt (agency `7835dc9`).

**The worker ran twice.**
1. **First live session** (`…-380ab72ed7a2-ebe7997a`, 20:23–20:27): it ran before API-GATEKEEPER1A
   landed, under the interactive gatekeeper.
   - It built most of `site/` and raised review question `GKREQ-9f5e…`.
   - Claude stopped that run when the owner chose "Route 2 now". The question was never answered and
     there was no relay.
   - Its records and work stayed in the tree, so six of the 19 paths in `7d627d7` come from it, and the
     unanswered request was committed in `d1710c7`.
2. **The brokered run, step by step:**

| Step | What happened | Commit or record |
|---|---|---|
| Worker | `claude-local` (Claude Code CLI), write grant `site/**`, picks up the prior session. Attempt 1: `validate-site` PASS, 3 LOW findings: the `example.com` canonical URL and sitemap, and the placeholder agency name. Attempt 2 re-ran and **marked them resolved as intentional placeholders**; the placeholders remain, for the owner to replace before any launch | session `SEO-AGENCY-WEBSITE1A-b3990d445904-9c9a05f8` |
| Review | `GKREQ-a4d090c3c1a82185f8b3b11a` (evidence-review, routine tier, gpt-5.6-luna) answered through the broker: `APPROVED_TO_PROCEED`. Forbidden: deploy, secrets-handling, payment, phase-closure | ledger 419 micro-USD; `GKDEC-GKREQ-a4d0…` |
| Technical commit and push | 19 paths, authored `ProjectOS implementer`, pushed; local equals `origin/work` | `7d627d7` |
| Run records | 7 records, committed and pushed by ProjectOS | `d1710c7` |
| Closure preparation | `validate-site` PASS; reviews complete **as worker-attested** (`closure/SEO-AGENCY-WEBSITE1A.json`); 0 unresolved CRITICAL/HIGH; 3 closure records committed by ProjectOS | `48a0d1b` |
| Closure question | `CLREQ-0b3a4b17e03c65e3b73788ed` (closure-review, strong tier, gpt-5.6-terra): **close** at `d1710c7` | ledger 6,309 micro-USD |
| Owner closure commit | The decision plus the ledger, byte-identical to what was presented, verified on read-back (`run4.log`) | `357e92a` |
| Closure | `closure resume`: `awaiting_closure -> closed`, closed by ChatGPT under the seo-agency-scoped phase-closure delegation; programme 1/1 | — |
| Post-close records | Phase record, state, and the decision's `consumedAt` | `cdf6085` (Claude, see D2) |

**Built site:** `site/index.html`, `styles.css`, `robots.txt`, `sitemap.xml`, `llms.txt`. It ships
nowhere. It has one non-executable JSON-LD script, no trackers and no remote assets, and its form posts
to `#`.

**Spend:** 6,728 micro-USD ($0.0067) of the $5 hard stop. **Relays: 0.**

## Owner acts (criterion 3)

The target is plan approval and the closure commit, with no relay.

**How the acts are identified.** No act is signed.
- The repository shows one shared git identity, `Murad`, for both the owner and Claude's commits. Claude's
  commits carry a `Co-Authored-By: Claude` trailer.
- **The closure commit `357e92a` was typed by the owner in their own terminal.** The owner pasted the
  terminal transcript into this conversation, and the commit has no Claude trailer.
- The plan decision, genesis, delegation and secrets-handling receipt are owner decisions given in this
  conversation and transcribed by Claude. Each says so, and the receipt is `tamperProof false`.

| # | Act | Against the target |
|---|---|---|
| 1 | Plan approval ("Approve") | Target |
| 2 | Closure commit `357e92a`, typed by the owner | Target |
| 3 | Route and credential decision: "Route 2 now", and "Hey, use this key for now. Once it's proven and no issues, then I will revoke. Until this project is completed this key stays". Transcribed into the secrets-handling receipt (`7835dc9`) | **Excess.** Cause: `secrets-handling` is an owner-only gate of the phase, and the brokered route needs the owner's credential. With a delegated route already in place, a later phase would need only a new receipt |
| 4 | Storing the key at the hidden credential prompt. Two tries: the first stored nothing because the clipboard was empty, and the prompt correctly refused an empty value | **Excess, one-time per installation.** Cause: the owner had pasted the key into the conversation, but the owner's rule is that Claude never uses, stores or repeats it, so only the owner can enter it |
| — | Post-close records `cdf6085` | Not an owner act; Claude committed them under the grant. Otherwise they would be another owner commit (D2) |

**Result: 2 target acts, plus 2 excess acts with their causes, and 0 relays.** Both excess acts set up
the credential route. Neither recurs per phase as long as the route stays in place.

## Defects the live run exposed (criterion 5)

| # | Severity | Defect and cause | Fix route |
|---|---|---|---|
| D1 | LOW (audit integrity) | **Model-authored closure timestamp accepted.** The closure decision records `decidedAt: "2025-02-15T00:00:00Z"`, 20 months before the request. Causes: the unattended closure prompt has the model fill `decidedAt` (`agent/src/loop/transports/closureResponses.ts:149`, schema at :72 and :86); core checks only that it is non-empty (`core/src/closureTransport.ts:398`) and copies it through (:479). No gate reads it, because replay and freshness rest on `consumedAt`, the subject head, the request digest and the owner commit. So the authority impact is nil and the audit trail is false. The owner committed it without noticing. The review decision was stamped correctly (`2026-10-25T22:27:33Z`). | Refuse a `decidedAt` outside the request-to-answer window, in `core/src/closureTransport.ts` (closure enforcement, excluded from this phase). This keeps the "nothing is stamped" design at `closureTurn.ts:611`. A **separate owner-gated amendment**. |
| D2 | MEDIUM (known, carried from MULTIPROJECT1A) | After the last phase closes, the persisted close (phase record, state, the decision's `consumedAt`) stays uncommitted. ProjectOS will not commit it because one of the files is the closure decision. | Exact-path persist step in `phase.ts` / `closureWait.ts`; a separate amendment. |
| D3 | LOW | **Receipt scope is prose, not machine-readable.** The receipt's note does name closure questions. But the broker checks only `ownerChoice: APPROVE` (`security/gatekeeper-transport-broker.cjs`), the funding disclaimer is hard-coded (`closure.ts:1006`), and the receipt, bound to `380ab72`, funded calls at later heads. | Give receipts a machine-readable scope (question kinds, subject range) that the broker checks. A separate amendment. |
| D4 | LOW | **No plain local bare remote.** `parseRemoteUrl` (`core/src/discovery.ts:23`) accepts only http(s) and ssh remotes, so a local bare repository needed a localhost HTTP git server. That server identifies every pusher as one fixed user, so any local process can push. | Accept `file://` or path remotes for local-only projects; a separate amendment. Mitigated now: non-fast-forward pushes and deletes are refused. |
| D5 | LOW | `continue --dry-run` writes brief files into `.projectops/execution/` (as documented at `run.ts:8`: it "prepares everything") and walks the same phase twice before reporting `NO_PROGRESS` (`programmeContinuation.ts:179-190`). Its two leftover briefs had to be removed by hand before the real run, so they are not kept as evidence. | The dry run should write no execution files, or label and clean them up. |
| D6 | MEDIUM (security review) | **The agency's governance forbids what the run did.** `.projectops/plan.json`, `project-config.json` and `authority/plan-genesis.json` forbid `use-openai-api`, `use-secrets` and `provider-credential-access`, and set `noApiPolicy: true`. The brokered run used OpenAI and read a credential, on the authority of the receipt's prose plus the `b3990d4` opt-in only. Neither the loop nor the broker compares the route against those declarations. | Two parts. Owner: amend the agency's governance block to name the brokered gatekeeper as a scoped exception, through a plan amendment. ProjectOS: refuse the broker route where the committed governance forbids provider API use. A separate amendment. |

No fix to ProjectOS was made in this phase. The exclusions forbid changes to closure, grant and broker
enforcement, and no in-scope test was needed: D1–D6 are recorded for amendments. The one fix made was
operational, on the agency's remote: refusing non-fast-forward pushes and deletes, and correcting the
README's stale remote path (agency `1f9dda2`).

## Carried forward, each with its trigger

- **Key rotation.** The owner: "Until this project is completed this key stays", and earlier: "If any
  credential or token rotation is required, it will be completed after ProjectOS project completion."
  - Trigger: when the owner declares ProjectOS complete.
  - Then the owner revokes the key at OpenAI, deletes the stored credential, and the agency's
    `gatekeeper.json` is set to `enabled: false` unless a new key is stored.
- **Provider-side spend cap.** The $5 hard stop is ProjectOS's own ledger. Owner action: set a monthly
  budget on the OpenAI project.
- **The temporary `seo-agency` allowlist entry.** Remove it when the agency proof is retired or Host
  credential custody (C5) is activated.
- **Broker answers carry no provenance class.** The phase record says "provenance unrecorded". A
  distinct "installation broker" class belongs in core.
- **`validate-site` hardening** (security review): allow only `application/ld+json` scripts; flag any
  `http` src, action, `<iframe>` or CSS `@import`; commit the fixtures. This is the agency's next phase.
- **Toolkit entry points:** rename or remove autosocial's runnable files if the agency is ever operated.
- **The localhost git server** stays up while the agency is governed from here. Stop it with the
  background task when the agency work pauses.
- **The unanswered `GKREQ-9f5e…`** from the first session stays committed. It is superseded by
  `GKREQ-a4d0…`, which answered the same phase.

## Checks

- **Agency:** `validate-site` PASS (1 page) at `cdf6085`; harness 13/13; remote in sync.
- **ProjectOS:** `val-projectos-boot-continue1a`, `validate-current-project-state` and
  `validate-no-secrets` PASS on the branch at `8bf95dd` with this document added.

## Reviews

- **ECC CODE (round 1): WARNING.** 0 CRITICAL, 1 HIGH, 5 MEDIUM, 4 LOW.
  - The HIGH: the owner-act count omitted the secrets-handling approval and route decision.
  - The MEDIUMs: missing carry-forwards; attribution unexplained; the wrong file named for D1; the
    first worker session not described; "13 fixture cases" unsupported.
  - It confirmed every commit id, request id, cost, model, pin and path count.
- **ECC SECURITY (round 1): approve with conditions.** 0 CRITICAL, 0 HIGH, 2 MEDIUM, 6 LOW.
  - No secret, no enabled posting path, and no executable that reaches out on the site.
  - The MEDIUMs: the agency governance forbids the API use (now D6), and owner acts are not provable
    from the repository.
  - The LOWs: D1 over-rated; `validate-site` weaker than policy; the git server open to any local
    pusher; the key and receipt still live; toolkits inert by policy only; the D3 wording.
- **Fix round:** every finding is answered in this document, as above. The operational fix is applied on
  the agency remote, and D1 is re-rated LOW with the correct files.
- **Round 2:**
  - ECC CODE: **APPROVE**, 0 CRITICAL, 0 HIGH. Remaining LOWs: the harness is off-tree, and "typed by
    the owner" rests on the owner's pasted transcript, not on the repository.
  - ECC SECURITY: **conditions met, approve**, 0 CRITICAL, 0 HIGH. D6 stays an owner-gated MEDIUM
    carry-forward. The loopback git server remains unauthenticated, mitigated by the deny flags.

## Verification commands

    cd C:\dev\SEOAgency; git log --format="%h %an | %s"; node projectos/validators/validate-site.cjs
    cd C:\dev\SEOAgency; type .projectops\gatekeeper-ledger.json
    node C:/dev/ProjectOS-candidate-backups/finish-external-proof1a/test-validate-site.cjs
    node projectos/validators/val-projectos-boot-continue1a.cjs
    node projectos/validators/validate-current-project-state.cjs
    node projectos/validators/validate-no-secrets.cjs
