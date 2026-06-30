# ERP System — Current State

> Current-state summary for the ERP System project, for ProjectOS Project Knowledge.
> Sourced read-only on 2026-06-30 with owner authorisation. `files.zip` inspected (BLUEPRINT extracted to scratch, original folder unchanged).

## Project identity

- **Name:** UK Auto Parts ERP (folder `C:\dev\ERP system`).
- **Type:** AI-powered Auto Parts ERP for the UK market. Stated goal: absolute lowest cost, maximum accuracy.
- **Stage:** Blueprint + initial scaffold only — `files.zip` contains 5 deliverables (`BLUEPRINT.md`, `schema.sql`, `main.py`, `ocr_processor.py`, `SearchParts.tsx`). Not a full running app yet.

## Repo

- **No git / not deployed.** Source is a 5-file `files.zip` archive. Repo / remote: `NEEDS SOURCE`.

## Stack (locked per BLUEPRINT)

- **DB + Auth:** Supabase (PostgreSQL + **pgvector**, RLS).
- **Backend:** FastAPI (Python 3.11+) — `main.py`: VRM lookup + semantic search + inventory endpoints.
- **Frontend:** Next.js 14 (App Router, TypeScript) — `SearchParts.tsx` smart search UI.
- **Embeddings:** sentence-transformers `all-MiniLM-L6-v2` (local, 768-dim, HNSW index).
- **AI routing:** Claude Haiku (bulk) → Claude Sonnet (escalation).
- **VRM lookup:** DVLA Vehicle Enquiry Service (free, 150/hr) + UKVehicleData (paid per call) — cached.
- **OCR:** tiered `pdfplumber` → `pytesseract` → Claude Haiku Vision (`ocr_processor.py` invoice pipeline).
- **Schema (`schema.sql`):** `suppliers`, `categories` (hierarchy), `inventory` (with `search_embedding vector(768)`), plus more.

## Security / data sensitivity

- Handles supplier master data, VAT, pricing, inventory, invoice OCR → financial + supplier PII; **high-risk** by default.
- Paid external API (UKVehicleData) + AI API usage → cost-control + key-management concern.
- ProjectOS should gate production deploy, DB mutation, and any paid-API/AI key usage.

## Production status

- **Pre-build / blueprint** — no deployment, no repo. `NEEDS SOURCE` for any live status.

## Recent closed phases

- None recorded (blueprint stage). `NEEDS SOURCE`.

## Current carry-forward queue

- Build-out from blueprint (schema apply, FastAPI service, Next.js frontend, OCR pipeline). Not yet phased. `NEEDS SOURCE`.

## Known risks / blockers

- Only a blueprint + 4 scaffold files; everything beyond is unbuilt.
- Paid VRM API + AI routing → live cost exposure once active.
- pgvector embedding pipeline + RLS need careful security review.

## ProjectOS installation considerations

- Treat as greenfield: ProjectOS could scaffold the delivery phases from `BLUEPRINT.md`.
- Gate production deploy, DB mutation, paid-API and AI-key usage.
- Establish a git repo before any controlled delivery.
- Install a project-local `.projectops` folder only after owner/advisor approval.

## Source confidence notes

- `BLUEPRINT.md` extracted from `files.zip` to scratch and read on 2026-06-30 under owner authorisation; original `C:\dev\ERP system` folder unchanged. Other 4 files listed but not opened.
- No secrets/keys present in BLUEPRINT (it names services, not keys).

## Source discipline

- **Confirmed from owner/project memory:** ERP System is a Murad project under `C:\dev`, folder `ERP system` (owner-confirmed 2026-06-30).
- **Confirmed from local docs (read-only, authorised):** Identity "UK Auto Parts ERP"; locked stack (Supabase+pgvector, FastAPI, Next.js 14, sentence-transformers, Claude Haiku/Sonnet, DVLA/UKVehicleData, tiered OCR); 5-file blueprint scaffold; schema tables incl `inventory.search_embedding vector(768)`.
- **Not verified:** Any build/deploy beyond blueprint; repo; live status.
- **Needs source:** Repo/remote; build progress; deployment; phase history.
