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