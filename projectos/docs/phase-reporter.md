# ProjectOS Phase Reporter

The phase reporter is a set of **local-only** scripts that generate and validate standard ProjectOS
reports (evidence packs, pre-push review packs, closure-report skeletons) and manage the Reports Index.

## What it does
- Generates a standard **evidence pack** from a JSON request or CLI fields.
- Generates a **pre-push review pack**.
- Generates a **closure-report skeleton**.
- **Validates** that a report has all required headings, a recognised status, the high-risk sections
  (production / database / external sends / payments), a decision-needed section, and no secret patterns.
- Appends rows to `knowledge/ProjectOS Reports Index.md` (explicit status only).

## What it does NOT do
- It does **not** approve or close phases. Closure remains a Murad/ChatGPT decision.
- It does **not** push, add remotes, or call git remotes.
- It does **not** call any external API or MCP tool.
- It does **not** write outside `C:\dev\ProjectOS` (output paths are guarded; paths outside are refused).
- It does **not** infer closure approval; `update-reports-index` requires an explicit status.

## Generate a report
```
node projectos/scripts/create-phase-report.cjs --input projectos/examples/demo-report-request.json --out projectos/examples/generated/demo-phase-report.md
```
Missing fields are filled with clear placeholders (`NEEDS SOURCE` / `NOT VERIFIED`).

## Pre-push review pack
```
node projectos/scripts/create-pre-push-review-pack.cjs --input <request.json> --out projectos/examples/generated/demo-pre-push-review-pack.md
```

## Closure report skeleton
```
node projectos/scripts/create-closure-report.cjs --input <request.json> --out projectos/examples/generated/demo-closure-report.md
```
The skeleton states that closure requires owner/advisor approval. It only writes report text when the
input explicitly carries an `ACCEPTED FOR CLOSURE` / `CLOSED` status — and even then it does not make
the decision; it records the supplied decision.

## Validate a report
```
node projectos/scripts/check-report-status.cjs --file <report.md>
npm run validate:reporter
```

## Update the reports index
```
node projectos/scripts/update-reports-index.cjs --date 2026-06-30 --project ProjectOS --phase <PHASE> --status AWAITING-REVIEW --commit <hash> --reportFile reports/<file>.md --notes "..."
```
Statuses: `AWAITING-REVIEW`, `AWAITING-CLOSURE`, `BLOCKED`, `DO-NOT-CLOSE`, `CLOSED`. Duplicate phase
rows are refused unless `--allow-duplicate`. Supports `--dry-run`.

## Why generation differs from approval
Report generation is mechanical evidence assembly. It accelerates Claude's reporting but changes no
authority: gates and closure stay with Murad/ChatGPT. Outputs are local-only and external APIs are
prohibited so the reporter can never take a real-world action.