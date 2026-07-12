"use strict";
/**
 * Forge Scaffold Engine — PROJECTOS-FORGE-SCAFFOLD1A (F2).
 *
 * Turns a blueprint (from F1) into a deterministic FILE MANIFEST for a running, secure-by-default
 * Next.js (App Router) + Supabase + Tailwind + shadcn monorepo. Templates are static strings with typed
 * slots filled from the blueprint — there is NO AI free-writing of structure, NO network, NO metered API.
 * Given the same blueprint it always emits the same manifest (sorted, no timestamps/randomness), so it is
 * unit-testable and replayable (`forge.config.json`).
 *
 * F2 produces the manifest ONLY (an array of { path, content }); materialising it to disk + installing
 * deps + running is F3 (the provisioner), which is owner-gated where it touches anything real.
 *
 * Secure by default (attacks the incumbents' top failure classes):
 *  - Two-client Supabase boundary: the service-role client is `import "server-only"` and the service-role
 *    key NEVER appears in a client-reachable file.
 *  - Row Level Security ON for every table with a default-deny + owner-scoped policies.
 *  - `.env.example` carries env var NAMES only — no values.
 *  - No metered-AI-API dependency is ever added.
 *  - `.projectops` governance (production frozen; metered AI API prohibited) is seeded from birth.
 */

const crypto = require("crypto");

function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}
function pascal(s) {
  return String(s || "").replace(/[^a-z0-9]+/gi, " ").trim().split(/\s+/).map((w) => w ? w[0].toUpperCase() + w.slice(1) : "").join("") || "X";
}
// Common Postgres reserved words that are invalid as an UNQUOTED table/column name. A generated ident
// that lands on one gets a trailing "_" so the emitted DDL is always valid without quoting.
const RESERVED_SQL = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "authorization", "between", "binary",
  "both", "case", "cast", "check", "collate", "column", "constraint", "create", "cross", "current_date",
  "current_role", "current_time", "current_timestamp", "current_user", "default", "deferrable", "desc",
  "distinct", "do", "else", "end", "except", "false", "for", "foreign", "from", "full", "grant", "group",
  "having", "in", "initially", "inner", "intersect", "into", "is", "join", "leading", "left", "like",
  "limit", "localtime", "localtimestamp", "natural", "not", "null", "offset", "on", "only", "or", "order",
  "outer", "overlaps", "placing", "primary", "references", "returning", "right", "select", "session_user",
  "similar", "some", "table", "then", "to", "trailing", "true", "union", "unique", "user", "using", "when",
  "where", "window", "with",
]);

/** Strict SQL identifier: lowercase, [a-z][a-z0-9_]* (no hyphens, no leading digit), reserved-safe. */
function ident(name) {
  let s = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) s = "t";
  if (/^[0-9]/.test(s)) s = "t_" + s;
  if (RESERVED_SQL.has(s)) s = s + "_";
  return s;
}
function sqlType(t) {
  const m = { text: "text", richtext: "text", boolean: "boolean", int: "integer", float: "double precision", date: "date", datetime: "timestamptz" };
  return m[t] || "text";
}
/** Neutralise a value used inside a generated single-line comment (strip newlines) — prevents comment
 *  escape / code injection from an attacker-influenced name. */
function safeComment(s) {
  return String(s || "").replace(/[\r\n]+/g, " ").slice(0, 120);
}
/** Throw if a manifest path could escape the project tree when F3 materialises it. */
function assertSafePath(p) {
  if (typeof p !== "string" || !p) throw new Error("scaffold-engine: empty manifest path");
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p) || p.includes("\\")) throw new Error("scaffold-engine: unsafe path " + p);
  if (p.split("/").some((seg) => seg === ".." || seg === ".")) throw new Error("scaffold-engine: path traversal " + p);
}
function ordinal(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

// ---- Templates (static strings with slots). Each returns file content. ----

function tplPackageJson(bp) {
  // Deps are fixed + minimal. NO openai/anthropic/metered-AI packages — ever.
  const pkg = {
    name: bp.projectId,
    private: true,
    version: "0.1.0",
    scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint", test: "vitest run" },
    dependencies: { next: "15.0.0", react: "18.3.1", "react-dom": "18.3.1", "@supabase/supabase-js": "2.45.0", "server-only": "0.0.1" },
    devDependencies: { typescript: "5.6.0", tailwindcss: "3.4.0", postcss: "8.4.0", autoprefixer: "10.4.0", vitest: "2.1.0", "@types/react": "18.3.0", "@types/node": "22.0.0" },
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

function tplEnvExample(bp) {
  // NAMES ONLY — never values. Owner supplies real values later via the secret broker.
  return bp.envVars.map((v) => v.name + "=").join("\n") + "\n";
}

function tplSupabaseServer() {
  return [
    'import "server-only";',
    'import { createClient } from "@supabase/supabase-js";',
    "",
    "// Service-role client. `server-only` makes importing this from a client component a BUILD ERROR, so",
    "// the service-role key can never reach the browser bundle. Instantiate AFTER auth checks only.",
    "export function createAdminClient() {",
    "  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;",
    "  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;",
    '  if (!url || !serviceKey) throw new Error("Supabase server env not configured");',
    "  return createClient(url, serviceKey, { auth: { persistSession: false } });",
    "}",
    "",
  ].join("\n");
}

function tplSupabaseClient() {
  return [
    'import { createClient } from "@supabase/supabase-js";',
    "",
    "// Browser client. Uses ONLY the public anon key + the caller's session, so Row Level Security is the",
    "// authorization boundary. The service-role key is never referenced here.",
    "export function createBrowserClient() {",
    "  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;",
    "  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;",
    '  if (!url || !anon) throw new Error("Supabase public env not configured");',
    "  return createClient(url, anon);",
    "}",
    "",
  ].join("\n");
}

const RESERVED_COLUMNS = ["id", "owner_id", "created_at"];

function tplMigration(bp) {
  const lines = ["-- Generated by Forge scaffold engine. RLS ON + default-deny + owner-scoped policies.", ""];
  for (const e of bp.dataModel.entities) {
    const table = ident(e.name); // strict identifier — no hyphens, no leading digit; safe unquoted
    lines.push("create table if not exists public." + table + " (");
    lines.push("  id uuid primary key default gen_random_uuid(),");
    lines.push("  owner_id uuid not null default auth.uid(),");
    const used = new Set(RESERVED_COLUMNS); // reserved cols can't be redefined by a caller field
    for (const f of e.fields) {
      let col = ident(f.name);
      while (used.has(col)) col = col + "_x"; // make caller field names unique + non-colliding
      used.add(col);
      lines.push("  " + col + " " + sqlType(f.type) + ",");
    }
    lines.push("  created_at timestamptz not null default now()");
    lines.push(");");
    lines.push("alter table public." + table + " enable row level security;");
    // Default deny is implicit once RLS is on; add explicit owner-scoped policies. `with check` on update
    // prevents a user re-parenting a row to another owner.
    lines.push("create policy \"" + table + "_select_own\" on public." + table + " for select using (auth.uid() = owner_id);");
    lines.push("create policy \"" + table + "_insert_own\" on public." + table + " for insert with check (auth.uid() = owner_id);");
    lines.push("create policy \"" + table + "_update_own\" on public." + table + " for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);");
    lines.push("create policy \"" + table + "_delete_own\" on public." + table + " for delete using (auth.uid() = owner_id);");
    lines.push("");
  }
  return lines.join("\n");
}

function tplSupabaseRequest() {
  return [
    'import { createClient } from "@supabase/supabase-js";',
    "",
    "// Per-request client bound to the CALLER's JWT + the public anon key. All queries run AS THE USER, so",
    "// Row Level Security is the enforcing authorization boundary. The service-role key is never used here.",
    "export function createRequestClient(token: string) {",
    "  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;",
    "  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;",
    '  if (!url || !anon) throw new Error("Supabase public env not configured");',
    "  return createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });",
    "}",
    "",
  ].join("\n");
}

function tplApiRoute(entity) {
  const table = ident(entity.name);
  return [
    'import { NextRequest, NextResponse } from "next/server";',
    'import { createRequestClient } from "@/lib/supabase/request";',
    "",
    "// Auth-guarded CRUD for " + safeComment(entity.name) + ".",
    "// Queries run through a user-scoped client, so Row Level Security enforces per-owner access; the",
    "// route also requires a session token before doing anything (defense in depth).",
    "export async function GET(req: NextRequest) {",
    '  const token = req.headers.get("authorization")?.replace("Bearer ", "");',
    '  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });',
    "  const supabase = createRequestClient(token);",
    '  const { data, error } = await supabase.from("' + table + '").select("*");',
    "  if (error) return NextResponse.json({ error: error.message }, { status: 400 });",
    "  return NextResponse.json({ data });",
    "}",
    "",
  ].join("\n");
}

function tplLayout(bp) {
  return [
    'import "./globals.css";',
    "",
    "export const metadata = { title: " + JSON.stringify(bp.name) + " };",
    "",
    "export default function RootLayout({ children }: { children: React.ReactNode }) {",
    '  return (<html lang="en"><body>{children}</body></html>);',
    "}",
    "",
  ].join("\n");
}

function tplPage(page, bp) {
  return [
    "export default function Page() {",
    '  return (<main className="p-8"><h1 className="text-2xl font-bold">' + escapeJsx(page.name) + "</h1>",
    '    <p className="text-gray-600">' + escapeJsx(page.purpose) + "</p></main>);",
    "}",
    "",
  ].join("\n");
}

function escapeJsx(s) {
  return String(s || "").replace(/[\r\n]+/g, " ").replace(/[<>{}]/g, "");
}

function tplProjectopsConfig(bp) {
  return JSON.stringify({
    schemaVersion: "1.0.0",
    projectId: bp.projectId,
    productionFreeze: true,
    governance: {
      autoAllowed: bp.governance.autoAllowed,
      ownerGated: bp.governance.ownerGated,
      prohibited: bp.governance.prohibited,
    },
    note: "Generated by ProjectOS Forge. Production is frozen; metered AI API is prohibited; deploy / live DB / real secrets / payments / push require owner approval.",
  }, null, 2) + "\n";
}

function tplForgeConfig(bp, manifestHash) {
  // Replay record: the blueprint + a hash of the emitted tree. Deterministic → same blueprint reproduces.
  return JSON.stringify({ schemaVersion: "1.0.0", generator: "forge-scaffold-engine", projectId: bp.projectId, blueprint: bp, manifestHash }, null, 2) + "\n";
}

function tplCi() {
  return [
    "name: ci",
    "on: [push, pull_request]",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-node@v4",
    "        with: { node-version: 20 }",
    "      - run: npm ci",
    "      - run: npm run build",
    "      - run: npm test",
    "",
  ].join("\n");
}

function tplStaticFiles(bp) {
  return {
    "next.config.mjs": "export default { reactStrictMode: true };\n",
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", lib: ["dom", "es2022"], jsx: "preserve", module: "esnext", moduleResolution: "bundler", strict: true, noUncheckedIndexedAccess: true, baseUrl: ".", paths: { "@/*": ["./*"] } }, include: ["**/*.ts", "**/*.tsx"] }, null, 2) + "\n",
    "tailwind.config.ts": 'import type { Config } from "tailwindcss";\nexport default { content: ["./app/**/*.{ts,tsx}"], theme: { extend: {} }, plugins: [] } satisfies Config;\n',
    "postcss.config.mjs": "export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n",
    "app/globals.css": "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n",
    ".gitignore": ["node_modules/", ".next/", ".env", ".env.*", "!.env.example", ""].join("\n"),
    "__tests__/smoke.test.ts": 'import { describe, it, expect } from "vitest";\ndescribe("smoke", () => { it("boots", () => { expect(true).toBe(true); }); });\n',
    "README.md": "# " + bp.name + "\n\nGenerated by ProjectOS Forge (local-first, owner-governed).\n\n- Stack: Next.js + Supabase + Tailwind + shadcn\n- Production is FROZEN. Deploy / live DB / real keys / payments / push require owner approval.\n- Copy `.env.example` to `.env` and fill values via the owner secret flow. Never commit real secrets.\n",
  };
}

/**
 * Build the deterministic file manifest for a blueprint. Returns { projectId, files } where files is a
 * path-sorted array of { path, content }. Pure — no disk, no network.
 */
function buildScaffold(blueprint) {
  const bp = blueprint;
  if (!bp || typeof bp !== "object" || typeof bp.projectId !== "string" || !bp.projectId) {
    throw new Error("scaffold-engine: a valid blueprint (with projectId) is required");
  }
  if (!bp.dataModel || !Array.isArray(bp.dataModel.entities)) throw new Error("scaffold-engine: blueprint.dataModel.entities required");
  if (!Array.isArray(bp.pages) || !Array.isArray(bp.envVars) || !bp.governance) throw new Error("scaffold-engine: incomplete blueprint");

  // Sort entities/pages so output is order-independent → deterministic. Ordinal (codepoint) compare, not
  // locale-sensitive, so replay is identical across machines/Node ICU builds.
  const entities = [...bp.dataModel.entities].sort((a, b) => ordinal(a.name, b.name));
  const pages = [...bp.pages].sort((a, b) => ordinal(a.path, b.path));
  const view = { ...bp, dataModel: { ...bp.dataModel, entities }, pages };

  const files = {};
  const put = (path, content) => {
    assertSafePath(path);
    if (Object.prototype.hasOwnProperty.call(files, path)) throw new Error("scaffold-engine: duplicate manifest path " + path);
    files[path] = content;
  };
  put("package.json", tplPackageJson(view));
  put(".env.example", tplEnvExample(view));
  put("lib/supabase/server.ts", tplSupabaseServer());
  put("lib/supabase/client.ts", tplSupabaseClient());
  put("lib/supabase/request.ts", tplSupabaseRequest());
  put("supabase/migrations/0001_init.sql", tplMigration(view));
  put("app/layout.tsx", tplLayout(view));
  put(".projectops/config.json", tplProjectopsConfig(view));
  put(".github/workflows/ci.yml", tplCi());
  for (const [p, c] of Object.entries(tplStaticFiles(view))) put(p, c);

  // One route file per page. Each path segment is sanitised so a hostile page.path can never traverse.
  for (const p of pages) {
    const rel = p.path === "/" ? "" : p.path.replace(/^\//, "").split("/").filter(Boolean).map((seg) => seg.replace(/[^a-zA-Z0-9_-]/g, "_")).join("/");
    const routeDir = rel ? "app/" + rel : "app";
    put(routeDir + "/page.tsx", tplPage(p, view));
  }
  // One API route per entity (slug is [a-z0-9-] only → safe path segment).
  for (const e of entities) put("app/api/" + slug(e.name) + "/route.ts", tplApiRoute(e));

  // Deterministic manifest hash over sorted (path -> content), then embed the replay config.
  const sortedPaths = Object.keys(files).sort();
  const hashBasis = sortedPaths.map((p) => p + " " + files[p]).join("");
  const manifestHash = "sha256:" + crypto.createHash("sha256").update(hashBasis).digest("hex");
  files["forge.config.json"] = tplForgeConfig(view, manifestHash);

  const finalPaths = Object.keys(files).sort();
  return {
    projectId: bp.projectId,
    manifestHash,
    files: finalPaths.map((p) => ({ path: p, content: files[p] })),
  };
}

module.exports = { buildScaffold, slug, ident, pascal };
