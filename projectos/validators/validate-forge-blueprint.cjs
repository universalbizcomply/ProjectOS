"use strict";
/**
 * Proves the Forge Blueprint Engine invariants (PROJECTOS-FORGE-BLUEPRINT1A / F1). Synthetic requests
 * only. If any invariant regresses, `run()` returns a non-empty error list and validate-all fails.
 *
 * Invariants:
 *  1  a non-empty request builds a blueprint with projectId/name/stack/governance
 *  2  an empty description throws (fail closed)
 *  3  the default stack is Next.js + Supabase + Tailwind + shadcn unless overridden
 *  4  a domain keyword seeds a data model + pages (todo → Task; shop → Product/Order)
 *  5  an integration keyword is detected with owner-gating + secret NAMES (stripe → payments, ownerGated)
 *  6  a metered-AI-API ask is REFUSED (in refusedIntegrations, never in integrations)
 *  7  env vars are names + placeholders only — no values, valueExposed:false, no secret-shaped strings
 *  8  governance: productionFrozen true and prohibited includes anthropic-api/openai-api/metered-llm-api
 *  9  one auth-required API contract per entity
 * 10  the plan gate is a non-empty owner-facing string (stack + production-frozen) with no secret value
 * 11  the engine is deterministic (same request → identical blueprint)
 * 12  caller-supplied entities are merged; a prototype-polluted request does not crash or pollute
 * 13  domain disambiguation: "booking app for a barber shop" resolves to Booking, not Product/Order
 * 14  stack override: a "vite spa" request flips the frontend to vite (documented override branch)
 * 15  hyphenated + possessive lexicon reachability: "e-commerce" → shop; "OpenAI's API" → refused
 */

const { buildBlueprint } = require("../forge/blueprint-engine.cjs");

const SECRET_RX = /-----BEGIN|sk-[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}/;

function run() {
  const errors = [];

  // 1: basic build.
  const bp = buildBlueprint({ description: "A simple app to track things" });
  if (!bp.projectId || !bp.name || !bp.stack || !bp.governance) errors.push("invariant 1: blueprint missing core fields");

  // 2: empty description throws.
  try { buildBlueprint({ description: "" }); errors.push("invariant 2: empty description did not throw"); }
  catch (e) { /* expected */ }

  // 3: default stack.
  if (bp.stack.frontend !== "next" || bp.stack.backend !== "supabase" || bp.stack.styling !== "tailwind" || bp.stack.ui !== "shadcn") {
    errors.push("invariant 3: default stack incorrect");
  }

  // 4: domain seeding.
  const todo = buildBlueprint({ description: "a todo list app to manage my tasks" });
  if (!todo.dataModel.entities.some((e) => e.name === "Task")) errors.push("invariant 4: todo domain did not seed a Task entity");
  const shop = buildBlueprint({ description: "an online store to sell products with a cart and orders" });
  if (!shop.dataModel.entities.some((e) => e.name === "Product") || !shop.dataModel.entities.some((e) => e.name === "Order")) {
    errors.push("invariant 4: shop domain did not seed Product/Order");
  }

  // 5: integration detection.
  const pay = buildBlueprint({ description: "a store with stripe checkout and subscription billing" });
  const payInt = pay.integrations.find((i) => i.id === "payments");
  if (!payInt || payInt.ownerGated !== true) errors.push("invariant 5: payments integration not detected/owner-gated");
  if (!payInt || !payInt.secretsRequired.includes("STRIPE_SECRET_KEY")) errors.push("invariant 5: payments secret names missing");

  // 6: refused AI API.
  const ai = buildBlueprint({ description: "a chatbot that calls the OpenAI API and the Anthropic API" });
  if (!ai.refusedIntegrations.some((r) => r.id === "ai-api")) errors.push("invariant 6: metered AI API not refused");
  if (ai.integrations.some((i) => i.id === "ai-api")) errors.push("invariant 6: refused AI API leaked into integrations");

  // 7: env var safety.
  const serialized = JSON.stringify(pay);
  if (SECRET_RX.test(serialized)) errors.push("invariant 7: blueprint contains a secret-shaped value");
  for (const v of pay.envVars) {
    if (v.valueExposed !== false) errors.push("invariant 7: env var exposes a value: " + v.name);
    if ("value" in v) errors.push("invariant 7: env var carries a value field: " + v.name);
  }

  // 8: governance.
  if (bp.governance.productionFrozen !== true) errors.push("invariant 8: production not frozen by default");
  for (const p of ["anthropic-api", "openai-api", "metered-llm-api"]) {
    if (!bp.governance.prohibited.includes(p)) errors.push("invariant 8: governance does not prohibit " + p);
  }

  // 9: API contracts.
  for (const e of shop.dataModel.entities) {
    const c = shop.apiContracts.find((x) => x.resource === e.name);
    if (!c || c.auth !== "required") errors.push("invariant 9: missing auth-required API contract for " + e.name);
  }

  // 10: plan gate.
  if (typeof bp.planGate !== "string" || !bp.planGate.includes("Stack:") || !/FROZEN/.test(bp.planGate)) {
    errors.push("invariant 10: plan gate missing stack / production-frozen line");
  }
  if (SECRET_RX.test(bp.planGate)) errors.push("invariant 10: plan gate contains a secret-shaped value");

  // 11: determinism.
  const a1 = buildBlueprint({ description: "a booking app for appointments with email reminders" });
  const a2 = buildBlueprint({ description: "a booking app for appointments with email reminders" });
  if (JSON.stringify(a1) !== JSON.stringify(a2)) errors.push("invariant 11: engine is not deterministic");

  // 12: caller entities + prototype-pollution safety + crash-safety on adversarial fields.
  const custom = buildBlueprint({ description: "a custom app", entities: [{ name: "Widget", fields: [{ name: "label", type: "text" }] }] });
  if (!custom.dataModel.entities.some((e) => e.name === "Widget")) errors.push("invariant 12: caller-supplied entity not merged");
  try {
    // Real literal — the `__proto__` key here sets the prototype (JSON.parse would not), a genuine test.
    buildBlueprint({ description: "x app", __proto__: { polluted: true } });
    buildBlueprint(JSON.parse('{"description":"y app","constructor":{"prototype":{"polluted":true}}}'));
    if (({}).polluted !== undefined) errors.push("invariant 12: Object.prototype was polluted by request");
    if (Object.getPrototypeOf({}) !== Object.prototype) errors.push("invariant 12: Object prototype chain was altered");
  } catch (e) {
    errors.push("invariant 12: prototype-polluted request crashed the engine: " + e.message);
  }
  try {
    const junk = buildBlueprint({ description: "an app", entities: [{ name: "E", fields: [null, 42, { name: "ok", type: "text" }] }, null, { fields: [] }] });
    if (!junk.dataModel.entities.some((e) => e.name === "E")) errors.push("invariant 12: valid entity dropped amid junk fields");
  } catch (e) {
    errors.push("invariant 12: adversarial entity fields crashed the engine: " + e.message);
  }

  // 13: domain disambiguation (substring "shop" inside "barber shop" must not beat "booking").
  const barber = buildBlueprint({ description: "a booking app for a barber shop with customer accounts" });
  if (!barber.dataModel.entities.some((e) => e.name === "Booking")) errors.push("invariant 13: booking app misclassified (no Booking entity)");
  if (barber.dataModel.entities.some((e) => e.name === "Product")) errors.push("invariant 13: booking app wrongly resolved to shop (Product entity present)");

  // 14: stack override — "vite spa" flips the frontend (exercises the documented override branch).
  const vite = buildBlueprint({ description: "a vite spa dashboard" });
  if (vite.stack.frontend !== "vite") errors.push("invariant 14: vite/spa override did not apply");

  // 15: hyphenated + possessive lexicon reachability — "e-commerce" resolves shop; "OpenAI's API" refuses.
  const ecom = buildBlueprint({ description: "an e-commerce site" });
  if (!ecom.dataModel.entities.some((e) => e.name === "Product")) errors.push("invariant 15: hyphenated 'e-commerce' term unreachable");
  const possessive = buildBlueprint({ description: "an app using OpenAI's API and Anthropic's API" });
  if (!possessive.refusedIntegrations.some((r) => r.id === "ai-api")) errors.push("invariant 15: possessive AI-API ask silently dropped the refusal");

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-forge-blueprint: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-forge-blueprint: PASS");
}
module.exports = { run };
