"use strict";
/**
 * Proves the Forge Scaffold Engine invariants (PROJECTOS-FORGE-SCAFFOLD1A / F2). Synthetic blueprints
 * only. If any invariant regresses, `run()` returns a non-empty error list and validate-all fails.
 *
 * Invariants:
 *  1  deterministic: same blueprint → identical file manifest + manifestHash
 *  2  required files present (package.json, next config, layout, supabase server+client, migration,
 *     .env.example, .projectops config, forge.config, CI, tests, README, tsconfig, tailwind)
 *  3  SECURE: the service-role key literal appears only in server-only files — NEVER in the client
 *     Supabase file or any app/ (client-reachable) file
 *  4  the server Supabase module is `import "server-only"`; the client module never references the service key
 *  5  Row Level Security is enabled with policies for every entity table
 *  6  no secret VALUES anywhere (env example is names-only; no secret-shaped strings)
 *  7  governance seeded: .projectops config has productionFreeze + prohibits metered AI API
 *  8  no metered-AI dependency (no openai/anthropic in package.json)
 *  9  per entity: a migration table + an auth-guarded API route
 * 10  all manifest paths are safe (relative, no traversal, no absolute)
 * 11  replayable: forge.config.json parses, embeds the blueprint + a matching manifestHash
 * 12  package.json / tsconfig / .projectops config are valid JSON
 * 13  hostile inputs fail closed: (a) newline entity name injects no code, (b) multi-word entity → valid
 *     SQL identifier, (c) reserved-column field doesn't duplicate, (d) page-path traversal can't escape,
 *     (e) colliding entity slugs are rejected
 */

const { buildBlueprint } = require("../forge/blueprint-engine.cjs");
const { buildScaffold, slug, ident } = require("../forge/scaffold-engine.cjs");

const SECRET_RX = /-----BEGIN|sk-[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}/;
const SERVICE_KEY = "SUPABASE_SERVICE_ROLE_KEY";

function fileMap(scaffold) {
  const m = {};
  for (const f of scaffold.files) m[f.path] = f.content;
  return m;
}

function run() {
  const errors = [];
  const bp = buildBlueprint({ description: "an online store to sell products with stripe checkout, orders and customer accounts" });
  const scaffold = buildScaffold(bp);
  const files = fileMap(scaffold);

  // 1: determinism.
  const again = buildScaffold(buildBlueprint({ description: "an online store to sell products with stripe checkout, orders and customer accounts" }));
  if (JSON.stringify(scaffold) !== JSON.stringify(again)) errors.push("invariant 1: scaffold is not deterministic");

  // 2: required files.
  const required = [
    "package.json", "next.config.mjs", "app/layout.tsx", "lib/supabase/server.ts", "lib/supabase/client.ts",
    "lib/supabase/request.ts", "supabase/migrations/0001_init.sql", ".env.example", ".projectops/config.json",
    "forge.config.json", ".github/workflows/ci.yml", "__tests__/smoke.test.ts", "README.md", "tsconfig.json", "tailwind.config.ts",
  ];
  for (const p of required) if (!(p in files)) errors.push("invariant 2: missing required file " + p);

  // 3 + 4: service-role key confined to server-only files.
  const serverOnlyAllowed = new Set(["lib/supabase/server.ts", ".env.example", "forge.config.json"]);
  for (const [path, content] of Object.entries(files)) {
    if (content.includes(SERVICE_KEY) && !serverOnlyAllowed.has(path)) {
      errors.push("invariant 3: service-role key referenced in a non-server-only file: " + path);
    }
  }
  if (files["lib/supabase/client.ts"] && files["lib/supabase/client.ts"].includes(SERVICE_KEY)) {
    errors.push("invariant 3: client Supabase module references the service-role key");
  }
  if (!files["lib/supabase/server.ts"] || !/^import "server-only";/.test(files["lib/supabase/server.ts"])) {
    errors.push("invariant 4: server Supabase module is not import \"server-only\"");
  }

  // 5: RLS per entity (using the engine's real identifier contract, incl. update WITH CHECK).
  const migration = files["supabase/migrations/0001_init.sql"] || "";
  for (const e of bp.dataModel.entities) {
    const table = ident(e.name);
    if (!migration.includes("create table if not exists public." + table)) errors.push("invariant 5: no table for " + e.name);
    if (!new RegExp("alter table public\\." + table + " enable row level security").test(migration)) errors.push("invariant 5: RLS not enabled for " + e.name);
    if (!migration.includes('"' + table + '_select_own"')) errors.push("invariant 5: no owner-scoped policy for " + e.name);
    if (!new RegExp('"' + table + '_update_own"[^\\n]*with check').test(migration)) errors.push("invariant 5: update policy missing WITH CHECK for " + e.name);
  }

  // 6: no secret values anywhere.
  for (const [path, content] of Object.entries(files)) {
    if (SECRET_RX.test(content)) errors.push("invariant 6: secret-shaped value in " + path);
  }
  const env = files[".env.example"] || "";
  for (const line of env.split("\n").filter(Boolean)) {
    if (!/=$/.test(line)) errors.push("invariant 6: .env.example line has a value (must be name only): " + line);
  }

  // 7: governance.
  let projectops;
  try { projectops = JSON.parse(files[".projectops/config.json"]); } catch (e) { errors.push("invariant 7/12: .projectops config invalid JSON"); projectops = null; }
  if (projectops) {
    if (projectops.productionFreeze !== true) errors.push("invariant 7: production not frozen in .projectops config");
    const prohibited = (projectops.governance && projectops.governance.prohibited) || [];
    for (const p of ["anthropic-api", "openai-api", "metered-llm-api"]) {
      if (!prohibited.includes(p)) errors.push("invariant 7: governance does not prohibit " + p);
    }
  }

  // 8: no metered-AI dependency.
  let pkg;
  try { pkg = JSON.parse(files["package.json"]); } catch (e) { errors.push("invariant 8/12: package.json invalid JSON"); pkg = null; }
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const bad of ["openai", "@anthropic-ai/sdk", "anthropic"]) if (deps[bad]) errors.push("invariant 8: metered-AI dependency present: " + bad);
    // Dependency versions must be caret ranges, not fragile exact ".0" pins — an exact pin like
    // typescript@5.6.0 does not exist on the registry and breaks `npm install` (found via a real install).
    for (const [name, ver] of Object.entries(deps)) {
      if (/^\d+\.\d+\.\d+$/.test(ver)) errors.push("invariant 8: dependency '" + name + "' uses an exact pin '" + ver + "' (use a caret range so it resolves)");
    }
  }

  // 9: per entity api route (real slug contract; RLS-enforcing user-scoped client, not service-role).
  for (const e of bp.dataModel.entities) {
    const routePath = "app/api/" + slug(e.name) + "/route.ts";
    if (!(routePath in files)) errors.push("invariant 9: missing API route for " + e.name);
    else {
      const c = files[routePath];
      if (!c.includes("unauthorized")) errors.push("invariant 9: API route for " + e.name + " is not auth-guarded");
      if (c.includes("createAdminClient") || c.includes(SERVICE_KEY)) errors.push("invariant 9: API route for " + e.name + " uses the service-role (RLS-bypassing) client");
      if (!c.includes("createRequestClient")) errors.push("invariant 9: API route for " + e.name + " does not use the RLS-enforcing user client");
    }
  }

  // 10: safe paths.
  for (const f of scaffold.files) {
    if (f.path.startsWith("/") || f.path.includes("..") || /^[a-zA-Z]:/.test(f.path)) errors.push("invariant 10: unsafe manifest path " + f.path);
  }

  // 11: replay.
  let forge;
  try { forge = JSON.parse(files["forge.config.json"]); } catch (e) { errors.push("invariant 11: forge.config.json invalid JSON"); forge = null; }
  if (forge) {
    if (forge.manifestHash !== scaffold.manifestHash) errors.push("invariant 11: forge.config manifestHash mismatch");
    // Deep replay check: the embedded blueprint must equal the (ordinally-sorted) blueprint.
    const sorted = { ...bp, dataModel: { ...bp.dataModel, entities: [...bp.dataModel.entities].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) }, pages: [...bp.pages].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
    if (JSON.stringify(forge.blueprint) !== JSON.stringify(sorted)) errors.push("invariant 11: forge.config blueprint is not a faithful replay copy");
  }

  // 12: tsconfig valid JSON.
  try { JSON.parse(files["tsconfig.json"]); } catch (e) { errors.push("invariant 12: tsconfig.json invalid JSON"); }

  // 13: adversarial / hostile blueprint inputs (entity/field/page derived from attacker-influenced text).
  // 13a: a newline in an entity name must not inject top-level code into the generated route.
  const injBp = buildBlueprint({ description: "an app", entities: [{ name: "Widget\nexport const PWNED = 1", fields: [] }] });
  const injScaffold = buildScaffold(injBp);
  const injFiles = fileMap(injScaffold);
  for (const [path, content] of Object.entries(injFiles)) {
    if (!path.endsWith(".ts") && !path.endsWith(".tsx")) continue;
    // A safe result keeps the name inert inside a `//` comment. A leak is a TOP-LEVEL injected statement
    // (a line that, trimmed, begins executable code the template never wrote).
    for (const line of content.split("\n")) {
      if (/^\s*export const PWNED/.test(line)) errors.push("invariant 13a: entity name injected top-level code into " + path);
    }
  }
  // 13b: a multi-word entity name yields a valid (underscored) SQL identifier, not a hyphen.
  const mwScaffold = buildScaffold(buildBlueprint({ description: "an app", entities: [{ name: "Order Item", fields: [] }] }));
  if (!fileMap(mwScaffold)["supabase/migrations/0001_init.sql"].includes("public.order_item")) errors.push("invariant 13b: multi-word entity did not produce a valid SQL identifier");
  // 13c: a field named like a reserved column must not duplicate the reserved column.
  const rc = fileMap(buildScaffold(buildBlueprint({ description: "an app", entities: [{ name: "Thing", fields: [{ name: "id", type: "text" }] }] })))["supabase/migrations/0001_init.sql"];
  if ((rc.match(/^\s*id\s/gm) || []).length !== 1) errors.push("invariant 13c: reserved column collision produced a duplicate/invalid column");
  // 13d: a hostile page path cannot escape the tree (all manifest paths stay safe — engine guard).
  const trav = buildScaffold({ ...bp, pages: [{ path: "/../../etc/cron.d/x", name: "X", purpose: "y" }] });
  for (const f of trav.files) if (f.path.includes("..") || f.path.startsWith("/")) errors.push("invariant 13d: page path traversal escaped the tree: " + f.path);
  // 13f: reserved SQL keywords as entity/field names produce valid (suffixed) identifiers, not broken DDL.
  const resv = fileMap(buildScaffold(buildBlueprint({ description: "an app", entities: [{ name: "Order", fields: [{ name: "when", type: "datetime" }, { name: "user", type: "text" }] }] })))["supabase/migrations/0001_init.sql"];
  if (/create table if not exists public\.order\s/.test(resv)) errors.push("invariant 13f: reserved table name 'order' emitted unquoted (invalid DDL)");
  if (/^\s*when\s/m.test(resv)) errors.push("invariant 13f: reserved column 'when' emitted unquoted (invalid DDL)");
  if (!resv.includes("public.order_")) errors.push("invariant 13f: reserved table name not made safe");

  // 13e: colliding entity slugs are rejected (fail closed, not silent last-writer-wins).
  try {
    buildScaffold(buildBlueprint({ description: "an app", entities: [{ name: "Order", fields: [] }, { name: "order", fields: [] }] }));
    errors.push("invariant 13e: colliding entity slugs were not rejected");
  } catch (e) { /* expected: duplicate manifest path */ }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-forge-scaffold: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-forge-scaffold: PASS");
}
module.exports = { run };
