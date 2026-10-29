# ProjectOS: name clearance, AI authorship, AI provider output terms, and open-source licence obligations

Research notes prepared for the founder to take to a lawyer. **This is not legal advice.** It sets out facts, sources and open questions. All searches were run on **29 October 2026**. Registers and web pages change, so the lawyer should re-run every search before relying on it.

Assumptions: the UK is the primary jurisdiction, with the US and EU secondary. The product is a local-first Windows desktop app and CLI, with a background Windows service, that governs AI coding agents. It is expanding into agent memory, skills, routines and a companion phone app. It is built largely with Claude Code, and it calls the OpenAI API for its gatekeeper.

---

## 1. Name check: "ProjectOS"

### 1.1 Method and limits

| Register / source | How it was queried | Result quality |
|---|---|---|
| **USPTO** | Direct queries to the public Trademark Search backend (`tmsearch.uspto.gov`) for `PROJECTOS`, `"PROJECT OS"`, `PROJECTS OS`, `PROJOS`, `"PROJ OS"`, `project*os`, `"PROJECT-OS"`, `"PROJECT O.S."`, and `project AND os`. The live record was then pulled from TSDR. | Good: direct register data |
| **EUIPO + UKIPO + WIPO (Madrid)** | **TMview** (https://www.tmdn.org/tmview/), run through a browser with "contains" and "fuzzy" word searches, filtered to offices GB, EM and WO. TMview carries UKIPO and EUIPO data. | Good, but TMview can lag the national registers |
| **UK IPO direct** (trademarks.ipo.gov.uk) | **Not queried directly.** The search form is a scripted application that could not be driven automatically. UK data was covered through TMview instead. | The lawyer should re-run it directly (see 1.5) |
| Companies House | Public name search | Good |
| Web, app stores, GitHub | Web search | Indicative only |
| Domains | RDAP and WHOIS lookups, plus a visit to each live site | Good as of the search date |

Note on the word: **"projectos" is a Portuguese word**, the pre-1990-reform spelling of *projetos*, meaning "projects". That explains the many Portuguese and Brazilian marks containing it. Most of them are architecture or engineering firms and are not relevant.

### 1.2 Trade mark conflicts found

| # | Mark | Owner | Office / number | Class(es) and goods/services | Status | Similarity to "ProjectOS" for AI-agent software | Source |
|---|---|---|---|---|---|---|---|
| **1** | **PROJECTOS** (standard characters) | **Infinite Snacks LLC**, Delaware, 8 The Green Ste B, Dover DE 19901. Attorney: Shaun H. Malvin, Avid Legal PLLC, Miami. | **USPTO SN 99201702** | **Class 42**: "Software as a service (SAAS) services featuring software for project management, task tracking, and team collaboration for use in the fields of professional services, legal services, consulting, business management, financial services, and marketing" | **LIVE, intent-to-use (s.1(b)).** Filed 25 May 2025. Published for opposition 11 Nov 2025 (no opposition shown). **Notice of Allowance 6 Jan 2026.** First extension of time to file the Statement of Use granted 6 May 2026. | **HIGH.** The word is identical. The services are closely related: class 42 project-management SaaS against class 9 and 42 software that runs plans, phases, reviews and approvals. The opposition window has closed. If the applicant files a Statement of Use, it registers with a **US constructive-use priority date of 25 May 2025**. | TSDR: https://tsdr.uspto.gov/statusview/sn99201702 ; USPTO search: https://tmsearch.uspto.gov/ |
| 2 | PROJECTOS | NIEPOORT (VINHOS) S.A. (Portuguese wine producer) | **EUTM 003652881** and the UK comparable mark **UK00903652881** | Class 33 (wines) | Registered (filed 17 Feb 2004) | Low. Identical word, but the goods are unrelated. Relevant only if the lawyer sees a reputation or dilution angle, which seems unlikely. | TMview: https://www.tmdn.org/tmview/#/tmview/results?page=1&pageSize=100&criteria=C&basicSearch=projectos |
| 3 | CAPITALPROJECTOS | Mariana Minerals Co. (Delaware) | USPTO SN 99798483 | Classes 9 and 42: mining-operations software, SaaS | Pending. Non-final action mailed (filed 30 Apr 2026). | Low to moderate. It contains "PROJECTOS", but adds "CAPITAL" and covers a different field (mining). | USPTO search (above) |
| 4 | CURA PROJECTOS | CURA - Projectos, Lda | EUTM 019324770 | Class 42 | Registered 2026 | Low. Composite mark in the architecture/engineering context. | TMview (above) |
| 5 | Artemis Projectos e Desenvolvimento Agrário | Letstrade, Lda | EUTM 018077644 / UK00918077644 | Classes 35 and 42 | Registered | Low (composite, agriculture) | TMview (above) |
| 6 | UI UNIDADE INFINITA, PROJECTOS | Unidade Infinita, Projectos, Lda | WIPO 986920 (Registered). US reg. 5876740 is **cancelled**. | Classes 20, 41, 42 (architecture) | Mixed | Low | USPTO / TMview |
| 7 | PROJECT SOS | Boys' and Girls' Clubs of NE Florida | USPTO 77154524 | Class 41 | Registered | Low | TMview |
| 8 | PROJECTPROS INTERNATIONAL CONSULTING SERVICES | ProjectPros Int'l | US reg. 2279106 | Class 42 | **Cancelled** (s.8) | None (dead) | USPTO |
| 9 | OS PROJECT | Welch Products, Inc. | US reg. 3036573 | Class 19 | **Cancelled** | None (dead) | USPTO |

**No exact "PROJECT OS" (two words), "PROJECTSOS", "PROJOS" or "PROJ OS" word mark was found** on the USPTO register, or on the UKIPO, EUIPO or WIPO data in TMview. The TMview "contains" search for `project os` returned 5,045 loose hits. Only the first 100 by relevance were screened, so the lawyer's search firm should do a full screen.

Other "PROJECT ..." marks on the UK/EU registers in classes 9/42 are not confusingly close on their face. Examples: PROJECT: MARA (Microsoft, EUTM 018773773, classes 9/41/42) and think project! (thinkproject Deutschland GmbH, classes 35/38/42). The lawyer should confirm this.

### 1.3 Unregistered and common-law users of the name (passing off in the UK, common-law rights in the US)

| User | What it is | Evidence | Relevance |
|---|---|---|---|
| **projectos.dev "ProjectOS"** | Live web SaaS: "The operating system for modern agencies", covering project P&L, capacity planning and financial dashboards. Free tier, then Premium at **$19.99/month or ฿599/month** (baht pricing suggests a Thai operator). "© 2026 ProjectOS." Operator not named. | https://projectos.dev (domain registered 19 Dec 2025) | **Moderate to high.** Identical name, overlapping "project operating system" positioning, and trading now. It could support a passing-off or prior-use argument wherever it has customers. |
| **projectos.io "projectOS™"** | Site titled "projectOS™" and locked in "preview mode". Uses the ™ symbol. | https://www.projectos.io/ ; domain **created 25 May 2025**, Porkbun, privacy-protected (US, NC) | **High, probably linked to conflict #1.** The domain was created on **the same day** Infinite Snacks filed USPTO SN 99201702. The correspondent email on that application is hello@infinitesnacks.com. The link is an inference, not proven. |
| Infinite Snacks LLC | Software studio ("Serious Business Tools" / "Ridiculous Nonsense"). No product named on its homepage. | https://infinitesnacks.com | Owner of conflict #1 |
| projectos.uk "Projectos" | GoDaddy site: "Projectos – Streamlining Your Project Success", "© 2026 Projectos". No operator or location given. | https://projectos.uk (registered 26 Feb 2026) | Moderate (UK domain, project-management positioning) |
| Honeywell "Projects OS" | "AI-enabled projects operating system for BMS delivery" (building automation). **Discontinued.** No ™/® on the page. | https://buildings.honeywell.com/au/en/products/by-category/software/building-control-software/cloud-software/projects-os | Low (discontinued, different field), but it is a large company's prior use of a near-identical name for AI project software |
| Notion templates "ProjectOS" / "Projects OS" / "A Project OS for humans and agents to collaborate" | Template listings | https://notion-proxy.senuto.com/pt-br/templates/projectos-project-management-for-teams ; https://fecamposs.gumroad.com/l/projectOS ; https://www.notion.com/en-gb/nicholas-project-os | Low individually, but they show that "Project OS" is used descriptively. This bears on distinctiveness (see 1.6). |
| "project-os" agent skill (peiiii/nextclaw) | Open-source skill for an AI-driven development workflow (rulebook, autonomous loop). Very close conceptually. | https://www.skills.sh/peiiii/nextclaw/project-os | Low legally (skill name, no trade use found), but **the same concept space** as ProjectOS |
| LemonOS "projectOS" | Hobby OS prototype (MIT), itch.io | https://lemonos-projects.itch.io/projectos | Low |
| kjur0/projectos (GitHub) | Hobby OS in C | (via search results) | Low |

### 1.4 UK company names (Companies House, 29 Oct 2026)

No company named exactly **PROJECTOS LTD** or **PROJECT OS LTD** was found.

Near names: PROJECTOSYSTEM LTD (06995346, dissolved), PROJECTO SOLUTIONS LTD (09453812, dissolved), NUNO'S PROJECTS LTD (09202271, formerly "PROJECTOS NA NET LTD"), OS PROJECTS LTD (08147429, in liquidation), OS PROJECTS & DEVELOPMENTS LTD (16653357), PROJECT OSIRIS CIC (SC715687).

Source: https://find-and-update.company-information.service.gov.uk/search/companies?q=projectos and https://find-and-update.company-information.service.gov.uk/search/companies?q=project+os

### 1.5 Domains (RDAP/WHOIS, 29 Oct 2026)

| Domain | Status | Notes |
|---|---|---|
| projectos.com | Registered 24 Jul 2003 (GoDaddy). Expires 2028. Nameservers **Afternic** (parked or for sale). | Probably purchasable at aftermarket price |
| projectos.io | Registered **25 May 2025** (Porkbun) | "projectOS™" preview site (see above) |
| projectos.ai | Registered 14 Nov 2025 (Porkbun). Transferred 26 Mar 2026. Expires 2029. | Did not resolve on the search date |
| projectos.dev | Registered 19 Dec 2025 | Live "ProjectOS" agency SaaS |
| projectos.app | **Expired 1 Sep 2026: "redemption period / pending delete"** | May become available to register in about early November 2026 |
| projectos.net | Registered 19 May 2002 | Content not verified |
| projectos.co.uk | Registered 17 Jun 2025 (Namecheap) | Did not resolve |
| projectos.uk | Registered 26 Feb 2026 (GoDaddy) | Live "Projectos" page |
| projectos.co | Not determined (WHOIS host unreachable) | Re-check |

Lookup method: `https://rdap.org/domain/<name>` and port-43 WHOIS (`whois.nic.io`).

### 1.6 Points the lawyer will want to weigh

- **Distinctiveness.** "Project" plus "OS" (operating system) is arguably descriptive or laudatory for project-management software, as in "the operating system for your projects". That cuts both ways. It makes ProjectOS harder to register and enforce. It may also narrow the protection the US PROJECTOS application gets, and that application is still unregistered (ITU).
- **US timing.** SN 99201702 has a Notice of Allowance. After the first six-month extension, the Statement of Use deadline is now about **6 Jan 2027**. Up to five extensions are possible, the last ending about **6 Jan 2029**. If the applicant never shows use, the application is abandoned. A letter of protest or opposition is no longer available because the publication window closed in Dec 2025. Once registered, a cancellation petition would be the route. Purchase, co-existence, or a consent agreement are commercial options.
- **UK/EU.** No identical class 9/42 mark was found on the UK or EU registers. The Niepoort class 33 PROJECTOS mark is identical in wording but covers unrelated goods.

**Exact searches for the lawyer or a search firm:**
- UK IPO: https://trademarks.ipo.gov.uk/ipo-tmtext. Word search for `PROJECTOS`, `PROJECT OS`, `PROJECTSOS`, `PROJ OS` with "similar" matching. Classes **9** (downloadable software, desktop and mobile apps), **42** (SaaS, software design, AI platform services), and consider **35** (business project management services) and **45** (if any governance or compliance services are offered).
- EUIPO eSearch: https://euipo.europa.eu/eSearch/ and TMview: https://www.tmdn.org/tmview/. Same terms, offices EM, GB, WO, plus the national registers of key EU markets.
- USPTO Trademark Search: https://tmsearch.uspto.gov/. Use `wordmark:projectos`, `wordmark:"project os"`, `wordmark:project*os`, and a pseudo-mark search, in classes 9, 42 and 35. Pull TSDR for SN **99201702** and SN **99798483**.
- WIPO Global Brand Database: https://branddb.wipo.int/
- A full clearance search covering phonetic variants, plus a common-law/web search for "Project OS", "ProjectOS" and "Projectos" as used for software.

Sources: USPTO TSDR status page for 99201702 (fetched 29 Oct 2026), https://tsdr.uspto.gov/statusview/sn99201702 ; TMview results (fetched 29 Oct 2026); RDAP via https://rdap.org ; sites listed above.

---

## 2. Copyright in AI-assisted software

### 2.1 United Kingdom

**Statute**
- Computer programs are protected as **literary works** (CDPA 1988 s.3(1)(b)).
- **s.9(3) CDPA**: "In the case of a literary, dramatic, musical or artistic work which is computer-generated, the author shall be taken to be the person by whom the arrangements necessary for the creation of the work are undertaken." https://www.legislation.gov.uk/ukpga/1988/48/section/9
- **s.178**: "computer-generated" means "generated by computer in circumstances such that there is no human author of the work". https://www.legislation.gov.uk/ukpga/1988/48/section/178
- **s.12(7)**: a computer-generated work is protected for 50 years from the end of the year it was made, not life plus 70 years. https://www.legislation.gov.uk/ukpga/1988/48/section/12
- The government's report (below) says that for a general-purpose AI that responds to a user prompt, "the 'author' will usually be the person who inputted the prompt".

**Originality standard**
- The UK applies the "author's own intellectual creation" test, inherited from EU law and confirmed by the Court of Appeal in **THJ Systems Ltd v Sheridan [2023] EWCA Civ 1354**, at [15] and [23]. The government report summarises it as: a work "must be original in the sense that it expresses the intellectual creation of its author, reflecting their personality and creative choices".
- The government also acknowledges a "legal contradiction" in s.9(3). The provision applies only to *original* works, but the originality test "is very much associated with human qualities". s.9(3) applies only to works "without a human author". There is no case law on how an "original yet wholly machine-authored work" would be defined.

**2024–25 consultation and its outcome**
- *Copyright and Artificial Intelligence* consultation (DSIT, DCMS, IPO): opened 17 Dec 2024, closed 25 Feb 2025, 11,520 responses. Questions 30–37 dealt with computer-generated works.
- The Data (Use and Access) Act 2025, s.136, required a report.
- **Outcome: the *Report on Copyright and Artificial Intelligence* and impact assessment, published 18 March 2026.**
  https://www.gov.uk/government/publications/report-and-impact-assessment-on-copyright-and-artificial-intelligence/report-on-copyright-and-artificial-intelligence
  - Computer-generated works: "We propose to continue to monitor the use and impact of protection for wholly computer-generated works. However, in the absence of evidence of its ongoing value, we propose that this specific type of protection should be removed, while copyright should continue to protect works created with AI assistance." (Executive summary, and Section I conclusions.)
  - AI-assisted works: "In general, any work made using AI as a tool, but where the creative expression in the work comes from a human creator, will meet this originality requirement… an original literary work which is edited with help from an AI assistant." (Section I)
  - 78% of online survey respondents opposed keeping computer-generated works protection. OpenAI told the consultation it "do[es] not claim copyright over generated outputs".
  - Labelling: "We propose to work with industry to explore best practice on labelling AI-generated content."
  - Text and data mining: the previously preferred opt-out exception (Option 3) was shelved (commentary: https://ipkitten.blogspot.com/2026/03/uk-report-on-copyright-and-artificial.html ; https://www.lewissilkin.com/en/insights/2026/03/24/opt-out-cop-out-uk-government-rethinks-its-position-on-copyright-and-ai-102mnx9 ; https://www.stephensonharwood.com/post/102mpke/uk-government-publishes-report-and-impact-assessment-on-copyright-and-artificial-intelligence-the-debate-continues/).
  - **Status: this is a proposal. No legislation had been introduced** as of the commentary reviewed. s.9(3) remains in force on 29 Oct 2026. The lawyer should confirm there has been no bill since.

**Practical consequence for ProjectOS (a question for the lawyer, not a conclusion).** Code where the founder's own creative choices are expressed is protected as an ordinary literary work. That includes architecture, structure, selection and arrangement, and the edits he makes. Code produced by an agent with little human creative input either falls under s.9(3), with 50 years' protection and the founder as "arranger", for now, or has no protection if s.9(3) is repealed or read narrowly. Repeal looks likely in the medium term. A related older case is *Nova Productions v Mazooma Games* [2007] EWCA Civ 219, which held that a game player was not an "arranger" of the computer-generated frames.

### 2.2 United States

- **Copyright Office, *Copyright and Artificial Intelligence, Part 2: Copyrightability* (29 January 2025).** https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf . Its conclusions, verbatim from the executive summary:
  - "The use of AI tools to assist rather than stand in for human creativity does not affect the availability of copyright protection for the output."
  - "Copyright protects the original expression in a work created by a human author, even if the work also includes AI-generated material."
  - "Copyright does not extend to purely AI-generated material, or material where there is insufficient human control over the expressive elements."
  - "Whether human contributions to AI-generated outputs are sufficient to constitute authorship must be analyzed on a case-by-case basis."
  - "Based on the functioning of current generally available technology, prompts do not alone provide sufficient control."
  - "Human authors are entitled to copyright in their works of authorship that are perceptible in AI-generated outputs, as well as the creative selection, coordination, or arrangement of material in the outputs, or creative modifications of the outputs."
  - "The case has not been made for additional copyright or sui generis protection for AI-generated content."
  - The report mentions software specifically. It notes that programmers already use automated tools to refactor and translate code, and that users can "'collaborate' with the model while writing a document or code".
- **Registration practice.** Applicants must disclose more than de minimis AI-generated material and describe the human contribution (Registration Guidance, 88 Fed. Reg. 16,190, 16 March 2023): https://www.copyright.gov/ai/ai_policy_guidance.pdf . Index of all the Office's AI reports: https://www.copyright.gov/ai/
- **Thaler v. Perlmutter.** The D.C. Circuit (No. 23-5233, Millett J., 18 March 2025) unanimously affirmed that the Copyright Act requires **human authorship**. It noted the requirement does not bar protection where a human uses or is assisted by AI. Commentary: https://www.goodwinlaw.com/en/insights/publications/2025/03/alerts-technology-dc-circuit-holds-that-ai-cannot-be-an-author ; https://ipwatchdog.com/2025/03/24/d-c-circuit-upholds-human-authorship-requirement-thaler-v-perlmutter/
  - **The Supreme Court denied certiorari on 2 March 2026** (No. 25-449), leaving the human-authorship rule standing. https://www.scotusblog.com/cases/thaler-v-perlmutter/ ; https://www.bakerbotts.com/thought-leadership/publications/2026/march/supreme-court-denies-petition-on-copyright-authorship-by-ai
- **Pending.** *Allen v. Perlmutter* (D. Colo., No. 1:24-cv-02665) tests whether extensive Midjourney prompting plus editing is authorship. Cross-motions for summary judgment were briefed through Jan 2026, and no ruling was found. https://chatgptiseatingtheworld.com/2024/09/27/jason-allen-v-shira-perlmutter-complaint-seeks-declaration-ai-prompted-theatre-dopera-spatial-is-work-of-authorship/
- **What records help**, based on the Part 2 report's own tests (control over expression, selection and arrangement, modification):
  - evidence that the human determined the expressive elements;
  - human-written portions, which should be identifiable;
  - the human's selection, coordination and arrangement of AI output, such as module structure and what was kept or discarded;
  - the human's creative modifications to AI output, shown in diffs;
  - for any registration, a disclaimer of AI-generated material and a description of the human contribution.

### 2.3 European Union (brief)

- Software is protected if it is "original in the sense that it is the author's own intellectual creation" (Software Directive 2009/24/EC, Art. 1(3)): https://eur-lex.europa.eu/eli/dir/2009/24/oj . The CJEU's general originality test comes from *Infopaq* (C-5/08) and *Painer* (C-145/10): free and creative choices, the author's "personal touch".
- There is no EU-level protection for computer-generated works without a human author. The UK report's comparative section says it is "unlikely that such wholly AI-generated outputs will benefit from copyright protection in the EU", citing the European Parliament study *Generative AI and Copyright*.
- The EU AI Act (Regulation (EU) 2024/1689) contains transparency duties, including Art. 50 on marking AI-generated content. These are separate from copyright and are mainly relevant if ProjectOS ships generative features to EU users: https://eur-lex.europa.eu/eli/reg/2024/1689/oj . The lawyer should confirm current application dates, given the EU's 2025–26 "digital omnibus" simplification proposals.

### 2.4 Practical evidence the founder should keep, and what already exists

Facts about the ProjectOS repository, checked on 29 Oct 2026:
- 876 commits on `main`. **505 commit messages carry a `Co-Authored-By: Claude …` trailer.** 871 commits are authored "Murad" and 5 "universalbizcomply". The earliest commit in the current history is dated 30 Jun 2026; earlier history may have been re-rooted, which the lawyer should ask about.
- The repo has a documented decision trail: `docs/00_Baseline_State.md` to `docs/06_Plan.md`, `docs/adr/` (architecture decision records), `docs/architecture/`, `docs/changes/delta_spec.md` (ADDED/MODIFIED/PROTECTED zones approved by the owner before code changes), owner approval and closure records under `.projectops`, and plan versions with owner decisions such as "PLANDEC-…" records.
- There is **no LICENSE or NOTICE file** at the repo root.

The trailers show that AI contributed to those commits. They also mark where the founder's own direction and review sit. The plan, ADR and approval records are strong evidence of human selection, arrangement and control.

Records to keep, in an exportable, dated, tamper-evident form:
1. **Decision logs.** ADRs, delta specs and plan approvals, showing that the human chose the architecture, interfaces, data model and trade-offs.
2. **Design documents.** PRD, App Flow, UI Spec, TRD, Schema. These are human-authored literary works in their own right.
3. **Prompts and direction.** Agent session transcripts, task briefs and the instructions given, especially where they fix expressive detail and are not just goals.
4. **Review and edit records.** Diffs between AI-proposed code and committed code, rejected proposals, manual rewrites, and review findings acted on.
5. **Attribution metadata.** Keep the Co-Authored-By convention consistent, or adopt a clearer convention that marks human-written, AI-drafted-then-human-edited, and AI-generated-unchanged code.
6. **Provider and plan records.** Which Anthropic and OpenAI account type, and therefore which terms, applied on which dates (see section 3).
7. **Third-party code provenance.** A software bill of materials and licence inventory, and any snippet-matching scans. OpenAI's Service Terms warn that code-generation output "may be subject to third party licenses, including, without limitation, open source licenses".

---

## 3. AI provider output terms

### 3.1 Anthropic: which terms apply to Claude Code

The Claude Code legal page (fetched 29 Oct 2026) says: "Your use of Claude Code is subject to: Commercial Terms of Service, for Team, Enterprise, and Claude API users; Consumer Terms of Service, for Free, Pro, and Max users." https://code.claude.com/docs/en/legal-and-compliance

The same page adds:
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."
- "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication… Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users."

This matters if ProjectOS drives Claude Code for its own users. That is a product-design question for the lawyer.

### 3.2 Anthropic Consumer Terms: UK version (Free, Pro, Max)

URL: https://www.anthropic.com/legal/consumer-terms (a UK visitor is served the GB version, also at https://www.anthropic.com/legal/consumer-terms/GB). **Effective 8 Oct 2025.**

- Contracting party and scope: "…the agreement between you and **Anthropic Ireland, Limited**… to use Claude.ai, Claude Pro, and other products and services that we may offer for individuals… **These Terms apply to you if you are a consumer who is resident in the United Kingdom.** You are a consumer if you are acting wholly or mainly outside your trade, business, craft or profession in using our Services."
- Ownership (s.4): "As between you and Anthropic, and to the extent permitted by applicable law, you retain any right, title, and interest that you have in such Inputs. **Subject to your compliance with our Terms, we assign to you all our right, title, and interest (if any) in Outputs.**"
- **Non-commercial restriction (s.11):** "**Non-commercial use only.** You agree not to use our Services for any commercial or business purposes and we (and our Providers) have no liability to you for any loss of profit, loss of business, business interruption, or loss of business opportunity."
- Competing-use restriction (s.3): users may not use the Services "To develop any products or services that compete with our Services, including to develop or train any artificial intelligence or machine learning algorithms or models or resell the Services."
- Reliance (s.4): "Outputs may not always be accurate and may contain material inaccuracies even if they appear accurate…"
- **No IP indemnity.** The word "indemnif…" does not appear in the operative text.
- Scope note: "If you are acting on behalf of an organization, company, or other entity, our Commercial Terms of Service govern your use of any Anthropic API key, the Anthropic Console… For clarity, this does not include Claude.ai or Claude Pro use for individuals or entities."
- **Comparison with the US version.** https://www.anthropic.com/legal/consumer-terms/US (same effective date) is a contract with **Anthropic, PBC**. It has the same output assignment ("we assign to you all of our right, title, and interest—if any—in Outputs") and the same competing-use restriction, but **no "Non-commercial use only" clause**.

**Fact for the lawyer.** If ProjectOS code was generated with Claude Code under a UK **Pro or Max** subscription, the UK consumer terms that applied contain a non-commercial-use covenant. The output assignment is "subject to your compliance with our Terms". The lawyer should advise on:
- whether this affects title to the outputs;
- whether the founder was a "consumer" at all, given he was acting for a business;
- what to do going forward, such as moving to Team, Enterprise or the API under the Commercial Terms;
- whether to seek confirmation from Anthropic.

### 3.3 Anthropic Commercial Terms (API, Team, Enterprise)

URL: https://www.anthropic.com/legal/commercial-terms. **Effective 17 Jun 2025.**

- Party: "'Anthropic' means Anthropic Ireland, Limited if Customer resides in the European Economic Area ('EEA'), Switzerland or UK, and Anthropic, PBC if Customer resides anywhere else." The terms are "not for consumer use".
- **B. Customer Content:** "As between the parties and to the extent permitted by applicable law, Anthropic agrees that Customer (a) retains all rights to its Inputs, and (b) owns its Outputs. Anthropic disclaims any rights it receives to the Customer Content under these Terms. Subject to Customer's compliance with these Terms, Anthropic hereby assigns to Customer its right, title and interest (if any) in and to Outputs. Anthropic may not train models on Customer Content from Services."
- **D.4 Use Restrictions:** "Customer may not and must not attempt to (a) access the Services to build a competing product or service, including to train competing AI models or resell the Services except as expressly approved by Anthropic; (b) reverse engineer or duplicate the Services; or (c) support any third party's attempt at any of the conduct restricted in this sentence."
- **K.1 IP indemnity (Anthropic to Customer):** "Anthropic will defend Customer and its personnel, successors, and assigns from and against any Customer Claim… and indemnify them for any judgment… or… settlement… 'Customer Claim' means a third-party claim, suit, or proceeding alleging that Customer's **paid use** of the Services (which includes data Anthropic has used to train a model that is part of the Services) in accordance with these Terms **or Outputs generated through such authorized use** violates any third-party intellectual property right."
- **K.3 exclusions:** "…Anthropic's defense and indemnification obligations will not apply to the extent the Customer Claim arises from: (a) modifications made by Customer to the Services or Outputs; (b) the combination of the Services or Outputs with technology or content not provided by Anthropic; (c) Inputs or other data provided by Customer; (d) use of the Services or Outputs in a manner that Customer knows or reasonably should know violates or infringes the rights of others; (e) the practice of a patented invention contained in an Output; or (f) an alleged violation of trademark based on use of an Output in trade or commerce."
  - Exclusions (a) and (b) matter for software. Committed code is usually modified and always combined with other code.
- K.2 Customer indemnity covers claims related to Customer Inputs, and use in breach of the Usage Policy or Service Terms.

### 3.4 OpenAI: API, used for the ProjectOS gatekeeper

**OpenAI Services Agreement** (APIs, ChatGPT Business/Enterprise). **Updated 1 Dec 2025, effective 1 Jan 2026.** https://openai.com/policies/services-agreement/

- Contracting party: "'OpenAI Contracting Party' means: (a) OpenAI OpCo, LLC, for Customers located outside the EEA or Switzerland; (b) OpenAI Ireland Ltd. for Customers located in the EEA or Switzerland…" **A UK business customer therefore contracts with OpenAI OpCo, LLC (US).** Disputes go to arbitration (s.15).
- **4.1 Customer Content:** "As between Customer and OpenAI, to the extent permitted by applicable law, Customer: (a) retains all ownership rights in Input; and (b) owns all Output. OpenAI hereby assigns to Customer all OpenAI's right, title, and interest, if any, in and to Output."
- **4.4 Similarity of Output:** "Due to the nature of OpenAI's Services and artificial intelligence generally, Output may not be unique, and other users may receive similar content from OpenAI's services. Responses that are requested by and generated for other users are not considered Customer's Output."
- **3.3(e) Restriction:** Customer will not "except for a Permitted Exception, use Output to develop artificial intelligence models that compete with OpenAI's products and services". "Permitted Exception" covers internal classifiers and embeddings that are not distributed, and OpenAI fine-tuning.
- **13.1 Indemnity by OpenAI:** "OpenAI agrees to indemnify, defend, and hold Customer harmless against any liabilities, damages and costs (including reasonable attorneys' fees) payable to a third party arising out of a Claim alleging that the Services infringe any third-party IP Right. This excludes claims to the extent arising from: (a) combination of any Services with products, services, or software not provided by OpenAI or on OpenAI's behalf; (b) modification of any Services by any party other than OpenAI; (c) Customer Content; (d) Customer Applications… In addition, the Service-Specific Terms Indemnity… is included in this Agreement, is not subject to any liability cap…"
- 13.4: "THE INDEMNITIES ARE A PARTY'S ONLY REMEDY UNDER THIS AGREEMENT FOR VIOLATION BY THE OTHER PARTY OF A THIRD PARTY'S IP RIGHTS."
- 14.2: the general liability cap is fees paid in the prior 12 months. Indemnification obligations are carved out of the cap.

**OpenAI Service Terms.** **Updated 16 Oct 2026.** https://openai.com/policies/service-terms/

- **1(a) API output indemnity:** "OpenAI's indemnification obligations to API customers under the Agreement include any third party claim that Customer's use or distribution of Output infringes a third party's intellectual property right. This indemnity does not apply where: (i) Customer or Customer's End Users knew or should have known the Output was infringing or likely to infringe, (ii) Customer or Customer's End Users disabled, ignored, or did not use any relevant citation, filtering or safety features or restrictions provided by OpenAI, (iii) Output was modified, transformed, or used in combination with products or services not provided by or on behalf of OpenAI, (iv) Customer or its End Users did not have the right to use the Input or fine-tuning files to generate the allegedly infringing Output, (v) the claim alleges violation of trademark or related rights based on Customer's or its End Users' use of Output in trade or commerce, and (vi) the allegedly infringing Output is from content from a Third Party Offering."
- **4. Codex and Code Generation:** "Output generated by code generation features of our Services, including OpenAI Codex, may be subject to third party licenses, including, without limitation, open source licenses."
- 2. Beta Services are "excluded from any indemnification obligations".

**OpenAI consumer terms, for comparison** (if ChatGPT personal accounts were also used): Europe Terms of Use, **updated 16 Jan 2026**, which "apply if you reside in the European Economic Area (EEA), Switzerland, or UK". https://openai.com/policies/terms-of-use/

- "As between you and OpenAI, and to the extent permitted by applicable law, you (a) retain your ownership rights in Input and (b) own the Output. We hereby assign to you all our right, title, and interest, if any, in and to Output."
- "Output may not be unique…"
- Unlike Anthropic's UK consumer terms, these contain a **"Business use of the Services addendum"** ("If you use our Services for commercial or business use, the following terms apply…") rather than a ban on commercial use.

### 3.5 Summary table

| | Anthropic Consumer (UK) | Anthropic Commercial | OpenAI Services Agreement + Service Terms (API) |
|---|---|---|---|
| Who owns output | Assigned to user "(if any)", subject to compliance | Customer owns, plus assignment "(if any)" | Customer owns, plus assignment "if any" |
| Commercial use | **Prohibited ("Non-commercial use only")** | Permitted | Permitted |
| Competing-product restriction | Yes, broad ("products or services that compete") | Yes ("build a competing product or service") | Narrower (competing *AI models*) |
| Output IP indemnity | **None** | Yes, for paid use. Excludes modified or combined outputs and patents. | Yes. Excludes modified, transformed or combined outputs, and cases where safety or citation features were ignored. |
| Uniqueness | Not addressed | Not addressed | Output "may not be unique" |
| Contracting entity for UK | Anthropic Ireland, Limited | Anthropic Ireland, Limited | OpenAI OpCo, LLC (US) |

None of the providers warrants that outputs are copyrightable. Every assignment is qualified by "if any". The assignment passes only whatever rights the provider has, and the law in section 2 decides whether any exist.

---

## 4. Open-source licence obligations (brief)

### 4.1 MIT

Grant: "Permission is hereby granted, free of charge, to any person obtaining a copy of this software… to deal in the Software without restriction, including… to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies…"

The only condition is that "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software." There is a warranty disclaimer. There is no patent clause, no change-marking duty and no NOTICE duty. https://opensource.org/license/mit

In a closed-source binary distribution, the usual practice is to ship each MIT component's copyright line and licence text, for example in a third-party-notices file or an About/Licences screen.

### 4.2 Apache-2.0

Text: https://www.apache.org/licenses/LICENSE-2.0

- **§4 Redistribution** (source or object form, modified or not) requires:
  - (a) "give any other recipients of the Work or Derivative Works a copy of this License";
  - **(b) "cause any modified files to carry prominent notices stating that You changed the files"**;
  - (c) retain, in source form, "all copyright, patent, trademark, and attribution notices";
  - **(d) if the Work includes a "NOTICE" file, include "a readable copy of the attribution notices contained within such NOTICE file"** in at least one of: a NOTICE file shipped with the product, the source or documentation, or "within a display generated by the Derivative Works, if and wherever such third-party notices normally appear".
  - You may license your own modifications, or the Derivative Work as a whole, under different terms, including proprietary terms, "provided Your use… otherwise complies with the conditions stated in this License". Closed-source commercial distribution is therefore allowed.
- **§3 Patent grant and termination:** each contributor grants a "perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license". However: "If You institute patent litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Work or a Contribution incorporated within the Work constitutes direct or contributory patent infringement, then any patent licenses granted to You under this License for that Work shall terminate as of the date such litigation is filed."
- **§6 Trademarks:** "This License does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor, except as required for reasonable and customary use in describing the origin of the Work and reproducing the content of the NOTICE file."
- §5: contributions back to a project are under Apache-2.0 by default. §7 and §8 disclaim warranty and liability.

**MIT vs Apache-2.0 in practice for ProjectOS**

| Obligation | MIT | Apache-2.0 |
|---|---|---|
| Include licence text | Yes | Yes (§4(a)) |
| Keep copyright notices | Yes | Yes (§4(c)) |
| NOTICE file contents | n/a | Yes, if upstream has one (§4(d)) |
| Mark modified files | No | **Yes, §4(b)** (affects vendored or patched files) |
| Express patent licence | No | Yes, terminates if you sue over the Work (§3) |
| Trademark use | Silent | Expressly excluded (§6) |

### 4.3 App-store distribution (companion phone app)

- MIT and Apache-2.0 impose no restriction on recipients that conflicts with Apple's or Google's store terms. The well-known App Store conflict concerns **copyleft (GPL)** licences: the FSF's 2010 GNU Go complaint and the 2011 VLC removal, because store usage rules add restrictions that GPL §6 forbids. https://www.theregister.com/2010/05/27/gnu_go_fsf_apple_itunes/ ; https://www.engadget.com/2011-01-09-the-gpl-the-app-store-and-you.html
- The practical duty is to deliver the notices inside the app, since users receive only the binary. Common patterns:
  - **Android:** Google's `oss-licenses-plugin` and `OssLicensesMenuActivity`, which Google provides "to comply with the license requirements of open source libraries". https://developers.google.com/android/guides/opensource
  - **iOS:** an in-app "Acknowledgements / Open-source licences" screen or Settings bundle, generated from CocoaPods, SwiftPM or Carthage metadata. Example: New Relic's iOS licence list, https://docs.newrelic.com/docs/licenses/license-information/mobile-app-licenses/ios-application-licenses
- For Apache-2.0 components, the in-app screen is a permitted place for NOTICE content: "within a display generated by the Derivative Works, if and wherever such third-party notices normally appear".
- The same applies to the Windows desktop installer (MSI) and the CLI. Ship a THIRD-PARTY-NOTICES file, and consider an About > Licences view. The repo currently has no LICENSE or NOTICE file at its root.

---

## Questions to ask the lawyer

**Name and trade marks**
1. Given USPTO SN 99201702 (PROJECTOS, class 42, ITU, Notice of Allowance 6 Jan 2026, held by Infinite Snacks LLC, apparently linked to projectos.io "projectOS™"), can we use and register "ProjectOS" in the US for class 9/42 AI-agent governance software? What are the options: wait for abandonment, petition to cancel after registration, negotiate co-existence or purchase, or rebrand for the US?
2. Should we file a UK trade mark application now, and an EUTM or Madrid designations? In which classes (9, 42, possibly 35 and 45) and with what specification wording? If we file in the UK first, can we use the 6-month Paris Convention priority for a later US filing, and how would that interact with the US applicant's earlier date of 25 May 2025?
3. How descriptive is "ProjectOS" ("project" plus "operating system")? Would a distinctive house mark or logo be needed for registration and enforcement?
4. Does the live "ProjectOS" agency SaaS at projectos.dev, or the "Projectos" UK site at projectos.uk, create a passing-off risk in the UK, or a prior-use problem?
5. Should we buy projectos.com (Afternic-parked) or register projectos.app when it drops? Is domain acquisition useful without trade mark clearance?
6. Can you run the UK IPO direct search, a full clearance search with phonetic variants, and an EUIPO/TMview check that we could not complete automatically?

**Copyright and authorship**
7. How much of the ProjectOS codebase is likely protected as ordinary literary works under THJ v Sheridan, and how much relies on CDPA s.9(3)? What happens to the s.9(3) portion if the government's March 2026 proposal to remove it is legislated? Would repeal apply retrospectively?
8. Do the 505 `Co-Authored-By: Claude` commit trailers help or hurt? Should we change the convention, and if so to what?
9. Which records (ADRs, delta specs, approvals, prompts, diffs, transcripts) should we preserve, in what form, and for how long, to prove human authorship in the UK, US and EU? Is it worth registering key code or documents with the US Copyright Office, with an AI disclaimer?
10. Who owns the code as between the founder personally and the company (universalbizcomply or another entity)? Do we need a written assignment from the founder to the company, and from any contractors?

**AI provider terms**
11. Much of ProjectOS appears to have been built with Claude Code. If that was under a UK **Pro or Max** consumer subscription, the Anthropic UK consumer terms contain "Non-commercial use only", and the output assignment is "subject to your compliance with our Terms". Does this affect our title to the outputs? Was the founder a "consumer" at all? Should we move to Team, Enterprise or API (Commercial Terms) immediately, and seek written comfort from Anthropic for past use?
12. Is ProjectOS, a governance layer for AI coding agents, at risk of being a "competing product or service" under Anthropic's Consumer s.3 or Commercial D.4 restrictions, or a model-competing use under OpenAI 3.3(e)?
13. If ProjectOS launches or drives Claude Code for its own end users, does our design comply with Claude Code's rules on OAuth and credential intermediation, and with the Commercial Terms requirement for embedding Claude Code?
14. How much real protection do the Anthropic K.1 and OpenAI 13.1 / Service Terms 1(a) output indemnities give, given that committed code is almost always "modified" and "combined"? Should we buy IP insurance instead, or as well?
15. OpenAI's API contracting party for a UK customer is OpenAI OpCo, LLC (US), with NAM arbitration. Is that acceptable, and what data-protection steps (DPA, international transfer mechanism) are needed for the gatekeeper's prompts?

**Open source and distribution**
16. Should we commission a software bill of materials and licence audit (including any GPL, LGPL or AGPL dependencies) before distributing the MSI, CLI and companion app? What notices must ship with each?
17. Have we modified any Apache-2.0 files, triggering §4(b) change notices? Do any dependencies carry NOTICE files we must reproduce?
18. How should the AI-generated code risk flagged in OpenAI Service Terms §4 (code "may be subject to third party licenses, including… open source licenses") be managed: snippet scanning, a policy, or warranties to our own customers?
19. What licence and EULA should ProjectOS itself use? What warranties and indemnities should we offer customers, given we receive only limited ones from AI providers?

---

*Compiled 29 Oct 2026 from the primary sources linked above: USPTO TSDR, TMview, Companies House, legislation.gov.uk, gov.uk, copyright.gov, anthropic.com, code.claude.com, openai.com and apache.org, plus secondary law-firm commentary where marked. Not legal advice.*
