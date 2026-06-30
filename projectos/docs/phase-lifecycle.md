# ProjectOS Phase Lifecycle

```
prompt -> implement -> local validate -> evidence pack -> owner/advisor review -> closure
```

1. **Prompt** — phase manifest defines id, type, objective, scope, allowed/forbidden paths+actions,
   required validators/reviews/evidence, approval gates, rollback plan, closure criteria, report path.
2. **Implement** — Claude makes only the changes inside allowed paths.
3. **Local validate** — run `npm run validate`; all validators must pass.
4. **Evidence pack** — produced from the standard template into `knowledge/reports/`.
5. **Review** — owner/advisor review the evidence.
6. **Closure** — only Murad/ChatGPT mark a phase CLOSED. Claude never self-closes.

A phase that touches a gated action (deploy/DB/real-send/payment) must stop and request explicit
owner approval before performing it.