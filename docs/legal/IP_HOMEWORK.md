# ProjectOS — IP and licensing homework pack

**Prepared for:** a UK solicitor's review, before ProjectOS is sold.
**Prepared by:** the founder (Murad) with Claude (Anthropic) as research assistant. 29 October 2026.
**Status:** factual preparation, **not legal advice**. Every finding is sourced in the supporting files, and
every open point is listed as a question.

## 1. The facts we are asking you to advise on

| | |
|---|---|
| Product | ProjectOS: a local-first Windows desktop app, a command-line tool and a background Windows service that govern AI coding agents (plans, reviews, spend caps, emergency stop). It is planned to grow into a personal agent platform with a companion phone app. |
| Proposed legal owner | **RBT Systems Limited** (trading as OPSoft), UK. **[Owner to confirm; company number to add.]** |
| Jurisdiction | UK first. The founder intends to move the business to a low- or no-tax country later. |
| How it will be offered | Sold as installed software (desktop, and later phone apps), and offered as a hosted service. Used internally today. |
| Repository | Private Git repository. `package.json` files mark it `private` / `UNLICENSED`. There is no LICENSE or NOTICE file at the repository root. |
| How it was built | The founder directed the work. Much of the code was written with AI assistance: 505 of 876 commits carry a `Co-Authored-By: Claude` trailer. The founder used a **personal Claude Pro/Max plan**. Design decisions, specifications, approvals and review records are kept in the repository (`docs/`, `.projectops/` decision records, phase evidence). |

## 2. Findings that most need your view

1. **Claude plan terms.** Our reading of Anthropic's UK consumer terms (Free/Pro/Max) is that they contain a
   "non-commercial use only" clause, and that output rights are assigned "subject to your compliance with our
   Terms". Anthropic's commercial terms (API/Team/Enterprise) allow commercial use, assign output to the customer
   and include an IP indemnity with exclusions. They also bar using the service to build a competing product.
   *Source: `name-and-ai-authorship.md` §3, quoted clauses with URLs and dates.*
2. **Product name conflict.** "PROJECTOS" is a pending US trademark application, SN 99201702, owned by
   Infinite Snacks LLC. It covers class 42 project-management SaaS, was filed on 25 May 2025 as intent-to-use,
   and has been allowed. A live "ProjectOS" SaaS exists at projectos.dev. The UK and EU registers show no
   identical software-class mark. A pre-screened shortlist is in `name-shortlist.md`. The top three are:
   - **Ruvane**: invented, with no software-class conflicts found;
   - **Steerhold**: no conflicts, but the .com was registered on 2026-10-01;
   - **Zarvel**: available, but phonetically close to MARVEL.

   This is a pre-screen, not a clearance search.
3. **Copyright in AI-assisted code.**
   - UK: CDPA s9(3), with the 18 March 2026 government report proposing its removal.
   - US: the Copyright Office's 2025 Part 2 report, and *Thaler v. Perlmutter*, where certiorari was denied on
     2 March 2026.
   - *Source: `name-and-ai-authorship.md` §2.*
4. **Third-party source code to be adopted.** ProjectOS will port code from six open-source projects:
   - five under MIT;
   - Rakazo under Apache-2.0, and Intel OpenBot, which embeds Apache-2.0 and BSD-3 files.

   No root NOTICE files exist. Flags:
   - AGPL-3.0 model weights (YOLOv5) are referenced by Intel OpenBot. They are downloaded at build time and are
     not in the source.
   - One Hermes fragment is ported from LobeHub, whose licence adds a commercial licence for derivative works.
     We will rewrite it, not port it.
   - Intel OpenBot carries a `DISCLAIMER.md` with use terms on top of MIT.
   - *Source: `vendor-provenance.md`.*
5. **Shipped dependencies.**
   - 1,225 unique packages were inventoried. No strong copyleft (GPL/AGPL/SSPL) ships.
   - Five MPL-2.0 Rust crates come in through Tauri: `cssparser`, `selectors`, `dtoa-short`, `option-ext`,
     `cssparser-macros`.
   - `crossbeam-channel` embeds CC-BY-3.0 and BSD-3 code.
   - 16 crates are under Unicode-3.0.
   - There is currently no third-party notices file in the product or the installer.
   - *Source: `dependency-licences.md`, plus two CSVs.*

## 3. What we have already prepared

- `THIRD_PARTY_NOTICES.draft.md`: a ready-to-commit credits file for the code to be ported. Licence texts are
  copied byte-for-byte from the sources. Dependency notices are listed separately in `dependency-licences.md`.
- `porting-convention.md`: a per-file header rule (source project, path, commit, licence, and "Modified by
  ProjectOS" for Apache files), a register of every ported file, and a validator that enforces both.
- An evidence trail of human direction: decision records quoting the founder verbatim, plan approvals,
  specifications and review reports, all in the repository.

## 4. Questions for you

1. Given the founder built ProjectOS on a personal Claude Pro/Max plan under UK consumer terms, does the
   "non-commercial use" clause affect RBT Systems Limited's ownership of, or right to sell, that code? Should all
   future work move to a commercial plan, and is any step needed for past work?
2. Do Anthropic's commercial-terms restriction on building a competing product, and any equivalent in OpenAI's
   API terms, affect a product that governs AI coding agents?
3. How should copyright be asserted in the AI-assisted code under UK law today, and what records should we keep
   going forward?
4. Should the founder personally assign existing IP to RBT Systems Limited, and if so how?
5. Planned move to a low- or no-tax country:
   - What is the right structure and timing for holding the IP?
   - What exit-tax or transfer-pricing exposure arises if the IP moves after it has value? (Also for an accountant.)
6. Name:
   - Is a UK/EU launch under "ProjectOS" safe given US SN 99201702 and projectos.dev?
   - Or should we adopt one of the shortlisted names and file UK IPO (classes 9, 42, possibly 35) first?
7. Are our MIT/Apache compliance steps sufficient for desktop, phone-app-store and hosted distribution? These are
   the notices file, an in-app licences screen, Apache change marking and the NOTICE handling.
8. MPL-2.0 Tauri crates: do our obligations end at notices and source availability, provided we never modify
   those files?
9. Intel OpenBot `DISCLAIMER.md`: does it bind us on top of MIT if we port that code?
10. Is the Apache-2.0 patent-termination clause a concern for our patent strategy, if any?
11. What end-user licence and hosted-service terms should ProjectOS ship with?
12. Any further questions raised in `vendor-provenance.md` (12 questions) and `name-and-ai-authorship.md`
    (19 questions).

## 5. Actions the founder can take now (no legal risk)

- Confirm the owning company's exact name and number.
- Move future AI-assisted development to a commercial plan (Anthropic API/Team/Enterprise), pending advice on
  past work.
- Add the notices file and the per-file porting convention before the first port lands. This is already
  planned.
- Keep all decision and review records. They are the human-authorship evidence.
- Pick a new name from the shortlist and file it in the UK. Hold off public launch under "ProjectOS".

## Supporting files

| File | What it contains |
|---|---|
| `name-and-ai-authorship.md` | Name conflicts, AI-authorship law (UK/US/EU), provider terms, licence duties; 19 questions |
| `vendor-provenance.md` | Licence, NOTICE, commit, embedded code and trademarks for the six source projects; 12 questions |
| `dependency-licences.md` + `.csv` | All 1,225 shipped and dev dependencies, classified and flagged |
| `THIRD_PARTY_NOTICES.draft.md` | Draft credits file for ported code |
| `porting-convention.md` | How ported files are marked and checked |
| `name-shortlist.md` | 10 alternative names pre-screened (USPTO, TMview incl. UK/EU, domains, languages); top 3 with next steps |
