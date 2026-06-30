# ProjectOS Reports Index

> Index and conventions for future ProjectOS / ProjectOps reports produced by Claude.

## Where future reports should be saved

Recommended local reports path:

```
C:\dev\ProjectOS\knowledge\reports
```

> Note: this folder is **not created** in the PROJECTOS-KNOWLEDGE-PACK1A phase. It is documented here only. It will be created when the first report is produced (or by a later approved phase).

## Naming convention

```
YYYY-MM-DD_<PROJECT>_<PHASE-ID>_<STATUS>.md
```

- `YYYY-MM-DD` — report date (ISO format).
- `<PROJECT>` — short project tag (e.g. `PolyGo`, `JDTesting`, `BizComply`).
- `<PHASE-ID>` — the phase identifier (e.g. `NOSEND1D-3`, `PROJECTOPS-UNIVERSAL1A`).
- `<STATUS>` — one of: `IMPLEMENTED-LOCALLY`, `AWAITING-REVIEW`, `APPROVED`, `CLOSED`, `BLOCKED`.

Example:

```
2026-06-30_PolyGo_PROJECTOPS-POLYGO-INSTALL1A_AWAITING-REVIEW.md
```

## How reports should be uploaded into ChatGPT Project Knowledge

1. Claude writes the report into `C:\dev\ProjectOS\knowledge\reports` (once that path exists / is approved).
2. Murad reviews the report.
3. On approval, Murad uploads the report file into the ChatGPT Project Knowledge area for **ProjectOS — Universal Project Delivery OS**.
4. The report is then logged in the table below.

Reports must follow security discipline: no raw secrets, no service_role keys, no Supabase access tokens, no GitHub PATs, no Vercel tokens, no staff JWTs. Redact any token-like value (use `TOKEN_REDACTED`, `URL_PLACEHOLDER`, `PROJECT_REF_PLACEHOLDER`).

## Reports log

| Date | Project | Phase | Status | Commit | Report file | Notes |
|------|---------|-------|--------|--------|-------------|-------|
| 2026-06-30 | ProjectOS | PROJECTOS-KNOWLEDGE-PACK1A | CLOSED | `408cccc` (report) | `reports/2026-06-30_ProjectOS_PROJECTOS-KNOWLEDGE-PACK1A_AWAITING-CLOSURE.md` | Closed by owner/advisor 2026-06-30. Memory artefacts excluded from deliverables; carry-forward recorded only. |
| 2026-06-30 | ProjectOS | PROJECTOPS-UNIVERSAL1A | CLOSED | `4373ffd` (baseline) | `reports/2026-06-30_ProjectOS_PROJECTOPS-UNIVERSAL1A_AWAITING-REVIEW.md` | Universal framework baseline. Closed by owner/advisor 2026-06-30. `npm run validate` ALL PASS. Carry-forward: basic validators; empty example dirs not to be populated this phase. |
