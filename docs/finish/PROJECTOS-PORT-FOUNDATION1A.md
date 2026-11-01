# PROJECTOS-PORT-FOUNDATION1A — credit foundation for the V4 ports

**Phase:** PROJECTOS-PORT-FOUNDATION1A, phase 1 of `docs/changes/delta_spec_V4_PORTS.md`, plan v1.31 (active).
**Branch:** `projectos-port-foundation1a`, worktree `C:/dev/ProjectOS-worktrees/port-foundation1a`, based on `b0768486`.
Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete. The required reviews are the lead's and have not happened. Full `validate-all` is
the lead's and was not run here.

This phase ports no upstream code. Nothing was run from a vendor folder.

## Delivered

| Item | File | Result |
|---|---|---|
| Notices | `THIRD_PARTY_NOTICES` | Entry format, six approved sources, the Pi / pi-mono note, an empty PORTED FILES section |
| Decision | `docs/adr/ADR-P1-port-ownership-and-credit.md` | Written. Status: approved in substance, not marked Accepted |
| Validator | `projectos/validators/val-projectos-port-credit1a.cjs` | 21 rules, 75 fixture and 44 record mutations; registered in both runners |
| Records | ADR-S1, ADR-S2, `docs/recon/V4_Capability_Recon.md` | ADOPT recorded as superseding, in the owner's words, with the history kept |
| Port map | `docs/recon/V4_Port_Map.md` | §1 re-pinned, downloads named, PolyForm warning, changed OpenBot file noted, §2 and §7 updated |
| Plan | `docs/06_Plan.md` | Stages 3 and 4 expanded with phases 3.5 to 3.10 and 4.4 to 4.9. Nothing ticked, Log untouched |

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| ADR-P1 states the owner's rule in the owner's words, what the owner may claim and what must be credited, the Apache-2.0 duties, and that a credit does not license non-commercial code | §1 to §5. PC-18 pins each, with 15 record mutations |
| A ported file with no header, no notices entry, an unknown source, or a source outside the approved list is refused by name, tested | PC-1, PC-5 and PC-3, with fixture mutations for each, plus a positive control |
| nightly-labs/openbot and any PolyForm source are refused by name, tested | PC-2, 9 fixture mutations: licence, URL, capitalised name, owner, folder, domain, pin, a comment in an original file, and the notices |
| ADR-S1, ADR-S2 and the capability recon no longer say code is never copied, and they cite the owner's decision | PC-19, 14 record mutations, including one per record that says code is never copied |
| Validator pin and named mutations, each killed by its own rule | 119 named mutations. A fixture mutation counts only when exactly its named rule fires, plus any rule declared as also true of it |

## Sources checked

Licence text was copied by script from each project's own `LICENSE` file, so none of it was typed. Each block in
`THIRD_PARTY_NOTICES` hashes to that file's SHA-256, and the validator pins that hash.

| Source | Licence read from | Pin read from the zip's archive comment | `LICENSE` SHA-256 |
|---|---|---|---|
| hermes-agent | `incoming-2026-11-01/hermes-agent/hermes-agent-main/LICENSE` | `hermes-agent-main.zip`: `d3e5868…` | `821556e6…` |
| openclaw | `incoming-2026-11-01/openclaw/openclaw-main/LICENSE` | `openclaw-main.zip`: `c5b56f2…` | `9efd316e…` |
| copilotkit-openbot | `incoming-2026-11-01/openbot-upper/OpenBot-main/LICENSE` | `OpenBot-main (2).zip`: `c396a5f…` | `6d35a6bb…` |
| oh-my-hermes | `oh-my-hermes/oh-my-hermes-main/LICENSE` | `oh-my-hermes-main.zip`: `612a1cd…` | `51a61c86…` |
| rakazo | `rakazo/rakazo-main/LICENSE` | `rakazo-main.zip`: `bf78ebd…` | `b9738182…` |
| isl-openbot | `openbot-master/OpenBot-master/LICENSE` (MIT, verified) | `OpenBot-master.zip`: `c5f0527…` | `7815496a…` |

- **Pi / pi-mono.** Its text comes from the Pi entry in OpenClaw's `THIRD_PARTY_NOTICES.md`, which is identical in the
  earlier clone and the 2026-11-01 download. ProjectOS holds no copy of Pi's own `LICENSE`.
- **Rakazo.** A case-insensitive search of its tree found no `NOTICE` file, so §4(d) adds no text. Its copyright line is `Copyright 2026
  Rakazo contributors`, verbatim.
- **OpenBot `server/src/computer/policy-network.ts`.** `cmp` confirms it differs between `4766e42` and `c396a5f`.
- **`openbot-lower`.** Never opened. Its folder name appeared in one listing of `incoming-2026-11-01`. The lowercase
  `openbot-main (1).zip` in Downloads was not read at all.

## Proofs

`node projectos/validators/val-projectos-port-credit1a.cjs`:

```text
val-projectos-port-credit1a: PASS (0 real file(s) judged; 75 fixture and 44 record mutations killed)
```

**The "0 real files" is deliberate and is not the proof.** The port directories hold nothing yet. `selfTest` always
runs, and writes its fixtures to one scratch directory, removed in a `finally`.

**Removing each rule.** A scratchpad harness, not committed, removed each rule body from an in-memory copy of the
validator and ran it against the real records. Result: `35 rule bodies removed, 0 problem(s)`. Each removal made the
run fail, naming that rule. It also made the validator refuse everything, which the positive control caught, and refuse
nothing, which 53 reported mutations caught. Stopping the directory walk from descending is caught by the positive
control too.

**The real tree, by hand.** A temporary file in the real `projectos/core/src/search/`, removed afterwards:

| File | Exit | Output |
|---|---|---|
| No mark | 1 | `PC-1 no header: projectos/core/src/search/probe.ts` |
| Header naming nightly-labs/openbot | 1 | `PC-2 denied source: ... it names a denied source: nightly-labs` |
| `// Origin: original ProjectOS code` | 0 | `1 real file(s) judged` |

**A real defect the mutations found.** `adr-names-the-legal-holder-as-fact` survived on the first run. The check was
per line, so a false statement beside the word "unconfirmed" passed. It is now per sentence.

## Validators that read a touched file

No validator names `V4_Port_Map`, `ADR-S1`, `ADR-S2`, `V4_Capability_Recon` or `06_Plan`. The grep over `trust-boundary`,
`validate-all` and `cached-runner` found 32 other validators. Each ran in its own process, together with
`validate-no-secrets` and this validator: **34 of 34 PASS**. That list includes `validate-speed-validation-cache` (the
two runners match), `val-projectos-kernel-followup1a`, `val-projectos-tenant-contract1a`,
`val-projectos-tenant-rls1a`, `val-projectos-trust-boundary1a` and `val-projectos-validator-scratch-lifecycle1a`.

That run was on the final content, before it was committed. The two required validators were run again on the committed
tree, and both passed.

## Corrections to the brief

- **ADR-S1, ADR-S2 and the recon were already amended.** Commit `be6059e8` added ADOPT with the owner's words on
  2026-10-29, so they no longer said code was never copied. What remained was the `## Decision: REFERENCE` heading,
  which still read as current. This phase added a superseding record, retitled that heading, relabelled the status
  line as "at the time", and retitled the recon's table as being about behaviours.
- **The plan number.** The delta says plan v1.30 carries phases 1 to 6. The active plan is v1.31. The delta is not in
  this phase's write paths, so it stays as it is.

## Limits

- **`docs/legal/` still shows earlier details.** `porting-convention.md` and `THIRD_PARTY_NOTICES.draft.md` name
  `THIRD_PARTY_NOTICES.md`, `PORTED_FILES.tsv`, `val-ported-file-provenance.cjs` and the earlier pins. They are outside
  this phase's write paths. ADR-P1 §10 says which wins.
- **The delta says a validator enforces every row of the ownership rule. It does not, and cannot.** A false "original"
  mark on a file with its marks removed, upstream names in identifiers, and sales claims are for review. ADR-P1 §8 says
  so.
- **Only the eight port directories are judged.** Later phases that port elsewhere must add their directory to ADR-P1
  and to the validator together.
- **The header is checked against the record, not against upstream.** The validator reads no vendor folder, because
  those exist only on this machine. It cannot confirm that a `Source-Path` really exists at the pin.
- **Embedded licences.** `isl-openbot` is approved for its MIT files only, and its `DISCLAIMER.md` is an open legal
  question.

## Open owner decisions

1. **The legal holder of original ProjectOS code.** ADR-P1 leaves it open and no file names a company.
2. **Formal acceptance of ADR-P1.** It is approved in substance only.
3. **The product name**, already open in the delta.

## Commits

- `96d3a68b` feat(validators): the port credit rule, notices file and ADR-P1
- `06226536` docs(recon): record ADOPT as superseding and re-pin the port sources
- The evidence commit that adds this file.
