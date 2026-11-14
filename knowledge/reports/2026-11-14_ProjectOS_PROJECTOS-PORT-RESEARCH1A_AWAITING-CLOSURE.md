# PROJECTOS-PORT-RESEARCH1A — awaiting closure

**Phase:** PROJECTOS-PORT-RESEARCH1A, phase 41 of 47 of plan v1.36
**Closure route:** owner-direct, under the owner's full-authority grant. No gatekeeper closure ruling was obtained, and none is claimed.

V4 port plan phase 4.8 (C16). OpenClaw and Hermes web search and fetch code translated under credit. Every fetch is address-pinned and SSRF-guarded across redirects with a total time budget; a paid search needs a spend grant answering exactly true, inside a timer, within a bounded run budget; the planner may fetch only URLs that came from search results or the question, and its search query is gated for exfiltration; fetched text is untrusted data, fenced and scanned; the answer text is filtered to a fixpoint (entities decoded, links, images, scheme-relative and bare host URLs defanged) and carries its citations. Pure rules over injected ports: nothing imports them but the core barrel (wiring is Stage 4.1).

Full record: `docs/finish/PROJECTOS-PORT-RESEARCH1A.md`.
