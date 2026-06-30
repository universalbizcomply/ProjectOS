# Report Index Row — how to write one

`knowledge/ProjectOS Reports Index.md` holds one table row per phase report. Columns:

```
| Date | Project | Phase | Status | Commit | Report file | Notes |
```

- **Date** — `YYYY-MM-DD`.
- **Project** — ProjectOS or the product name (e.g. PolyGo).
- **Phase** — phase id (e.g. PROJECTOPS-PHASE-REPORTER1A).
- **Status** — one of: `AWAITING-REVIEW`, `AWAITING-CLOSURE`, `BLOCKED`, `DO-NOT-CLOSE`, `CLOSED`.
- **Commit** — relevant commit hash(es).
- **Report file** — path under `knowledge/reports/`.
- **Notes** — short summary; no secrets.

Rows are appended by `projectos/scripts/update-reports-index.cjs` (status must be supplied explicitly;
the script never infers closure approval and never pushes). Closure (`CLOSED`) is only written when an
owner/advisor decision has already been made.