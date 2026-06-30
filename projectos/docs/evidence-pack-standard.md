# ProjectOS Evidence Pack Standard

Every phase ends with an evidence pack (see `projectos/templates/evidence-pack.template.md` and
`projectos/schemas/evidence-pack.schema.json`).

## Required sections
- Project, Phase, Status, Branch, Commit
- Files changed
- Scope
- Forbidden actions checked
- Validators
- tsc / build / eslint
- Security review
- Code review
- Database review
- Staging proof
- Production touched?
- External sends / payments?
- Residue
- Risks
- Carry-forward
- Decision needed

## Rules
- Unknowns are marked clearly; nothing uncertain is stated as certain.
- No secrets; redact any token-like value.
- The pack is for owner/advisor review; it does not itself close the phase.
## Controlled review sections

The evidence pack also captures controlled review outputs: Code Review, Security Review, Database Review, Build/Lint/Typecheck Review, Test Review, Quality Gate Review, Planner Review, Silent Failure Review, plus Review Scope / Limitations, External Tools Used, MCP Used, and Owner Approval Required. Each review records status, scope, limitations and an advisory recommendation (not an approval). See [ecc-review-wiring.md](ecc-review-wiring.md).
