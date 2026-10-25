"use strict";
/**
 * Forge Blueprint Engine — PROJECTOS-FORGE-BLUEPRINT1A (F1).
 *
 * Turns a plain-language project request into a deterministic, structured BLUEPRINT — the plan that later
 * Forge stages scaffold from. It is pure, zero-dependency, NO AI, NO network, NO metered API: given the
 * same request it always yields the same blueprint (unit-testable, auditable, offline). The blueprint is
 * an owner-visible "plan gate": the owner sees exactly what would be built before anything is scaffolded.
 *
 * Fail-safe defaults: stack defaults to Next.js + Supabase + Tailwind + shadcn; integrations come from a
 * fixed allowlist (unknown asks are surfaced, never silently added); env vars are NAMES + placeholders
 * only (no values — redaction-safe); production is frozen; and any AI/metered-API integration is REFUSED
 * by construction (owner directive: no Claude/ChatGPT/metered API).
 */

/** Recursively freeze so no in-process code can flip a security flag (e.g. an integration's ownerGated). */
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

const DEFAULT_STACK = deepFreeze({
  frontend: "next",        // Next.js App Router
  backend: "supabase",     // Postgres + auth + storage + edge functions
  styling: "tailwind",
  ui: "shadcn",
  runtime: "node",
});

// Integration allowlist. `secretsRequired` are ENV VAR NAMES only — never values. `ownerGated` means a
// real key/live use routes through the approval queue + provider guards; local/synthetic works without.
const INTEGRATIONS = deepFreeze({
  auth:     { terms: ["login", "signup", "sign in", "sign up", "auth", "account", "accounts", "user", "users", "session"], secretsRequired: [], ownerGated: false },
  payments: { terms: ["payment", "payments", "checkout", "stripe", "subscription", "subscriptions", "billing", "charge", "invoice", "paywall"], secretsRequired: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], ownerGated: true },
  email:    { terms: ["email", "emails", "notify", "notification", "notifications", "resend", "sendgrid", "mail"], secretsRequired: ["EMAIL_API_KEY"], ownerGated: true },
  storage:  { terms: ["upload", "uploads", "file", "files", "image", "images", "photo", "photos", "storage", "attachment"], secretsRequired: [], ownerGated: false },
  realtime: { terms: ["realtime", "real-time", "live", "presence", "chat", "messaging", "collaborate"], secretsRequired: [], ownerGated: false },
  search:   { terms: ["search", "filter", "full-text", "find"], secretsRequired: [], ownerGated: false },
});

// Refused by construction — the owner directive forbids any metered/hosted AI API.
const REFUSED_INTEGRATIONS = deepFreeze({
  // Single-token provider/product names so possessives or extra words ("OpenAI's API", "OpenAI Chat API")
  // still trigger the refusal notice. Matching any of these flags a metered-AI-API ask.
  "ai-api": { terms: ["openai", "anthropic", "chatgpt", "gpt4", "gpt", "llm", "gemini", "grok", "copilot", "openai api", "anthropic api", "claude api", "metered api"], reason: "metered-ai-api-forbidden" },
});

// Domain heuristics: a known domain keyword seeds a starter data model + pages. Extensible + deterministic.
// Order = tie-break priority when two domains match the same number of terms. Intent-leading domains
// (booking/crm/blog/todo) come before the broad "shop" so e.g. "booking app for a barber shop" resolves
// to booking, while "store to sell products with a cart and orders" still wins shop on match count.
const DOMAINS = deepFreeze({
  booking: { terms: ["booking", "bookings", "appointment", "appointments", "reservation", "reservations", "schedule", "calendar", "barber", "salon"], entities: [{ name: "Booking", fields: [{ name: "when", type: "datetime" }, { name: "status", type: "text" }, { name: "notes", type: "text" }] }], pages: [{ path: "/", name: "Book", purpose: "pick a slot" }, { path: "/admin", name: "Schedule", purpose: "manage bookings" }] },
  crm:     { terms: ["crm", "lead", "leads", "contact", "contacts", "pipeline", "deal", "deals"], entities: [{ name: "Contact", fields: [{ name: "name", type: "text" }, { name: "email", type: "text" }, { name: "stage", type: "text" }] }], pages: [{ path: "/", name: "Pipeline", purpose: "manage contacts" }] },
  blog:    { terms: ["blog", "post", "posts", "article", "articles", "cms"], entities: [{ name: "Post", fields: [{ name: "title", type: "text" }, { name: "body", type: "richtext" }, { name: "published", type: "boolean" }] }], pages: [{ path: "/", name: "Feed", purpose: "list posts" }, { path: "/post/[id]", name: "Post", purpose: "read a post" }] },
  todo:    { terms: ["todo", "task", "tasks", "checklist"], entities: [{ name: "Task", fields: [{ name: "title", type: "text" }, { name: "done", type: "boolean" }, { name: "dueDate", type: "date" }] }], pages: [{ path: "/", name: "Tasks", purpose: "list + add tasks" }] },
  dashboard: { terms: ["dashboard", "analytics", "metrics", "report", "reports", "kpi"], entities: [{ name: "Metric", fields: [{ name: "name", type: "text" }, { name: "value", type: "float" }, { name: "at", type: "datetime" }] }], pages: [{ path: "/", name: "Dashboard", purpose: "view metrics" }] },
  shop:    { terms: ["shop", "store", "ecommerce", "e-commerce", "product", "products", "cart", "order", "orders", "catalog"], entities: [{ name: "Product", fields: [{ name: "name", type: "text" }, { name: "priceCents", type: "int" }, { name: "stock", type: "int" }] }, { name: "Order", fields: [{ name: "total", type: "int" }, { name: "status", type: "text" }] }], pages: [{ path: "/", name: "Catalog", purpose: "browse products" }, { path: "/cart", name: "Cart", purpose: "checkout" }] },
});

function normalize(s) {
  return (typeof s === "string" ? s : "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function slug(name) {
  const s = normalize(name).replace(/\s+/g, "-");
  return s || "app";
}

/**
 * Single source of truth for matching. The term is normalized the SAME way as the request (so a lexicon
 * entry like "e-commerce" / "real-time" becomes the phrase "e commerce" / "real time" and matches what
 * `normalize` actually produces). Multi-word → padded substring; single word → word-boundary. The regex
 * is built from a fixed, normalized (alphanumeric+space) lexicon, so it is linear — no ReDoS.
 */
function termMatches(norm, padded, term) {
  const t = normalize(term);
  if (!t) return false;
  if (t.includes(" ")) return padded.includes(" " + t + " ");
  return new RegExp("(^| )" + t + "( |$)").test(norm);
}

function countMatches(norm, padded, terms) {
  let n = 0;
  for (const t of terms) if (termMatches(norm, padded, t)) n += 1;
  return n;
}

function mentionsAny(norm, padded, terms) {
  return terms.some((t) => termMatches(norm, padded, t));
}

/** Score each domain by matched-term count; highest wins, first-declared wins ties (strict >). */
function detectDomain(norm, padded) {
  let best = null;
  let bestScore = 0;
  for (const [key, d] of Object.entries(DOMAINS)) {
    const score = countMatches(norm, padded, d.terms);
    if (score > bestScore) { best = { key, ...d }; bestScore = score; }
  }
  return best;
}

function detectIntegrations(norm, padded) {
  const out = [];
  for (const [id, cfg] of Object.entries(INTEGRATIONS)) {
    if (mentionsAny(norm, padded, cfg.terms)) {
      out.push({ id, why: "requested", secretsRequired: cfg.secretsRequired.slice(), ownerGated: cfg.ownerGated });
    }
  }
  return out;
}

function detectRefusedIntegrations(norm, padded) {
  const out = [];
  for (const [id, cfg] of Object.entries(REFUSED_INTEGRATIONS)) {
    if (mentionsAny(norm, padded, cfg.terms)) out.push({ id, reason: cfg.reason });
  }
  return out;
}

/** Coerce an untrusted value to a string without letting a hostile toString() throw out of the engine. */
function safeStr(v, fallback) {
  if (typeof v === "string") return v;
  try { return v === undefined || v === null ? (fallback || "") : String(v); }
  catch (e) { return fallback || ""; }
}

/** Data model + pages from a domain heuristic plus any caller-supplied explicit entities. Crash-safe. */
function resolveDataModel(domain, req) {
  const entities = [];
  const pages = [{ path: "/", name: "Home", purpose: "landing / entry" }];
  if (domain) {
    for (const e of domain.entities) entities.push({ name: e.name, fields: e.fields.map((f) => ({ ...f })) });
    pages.length = 0;
    for (const p of domain.pages) pages.push({ ...p });
  }
  if (Array.isArray(req.entities)) {
    for (const e of req.entities) {
      if (e && typeof e === "object" && typeof e.name === "string" && e.name) {
        const fields = Array.isArray(e.fields)
          ? e.fields.filter((f) => f && typeof f === "object").map((f) => ({ name: safeStr(f.name, "field"), type: safeStr(f.type, "text") || "text" }))
          : [];
        entities.push({ name: e.name, fields });
      }
    }
  }
  return { entities, pages };
}

/** Env var manifest — NAMES + placeholders only, never values. */
function buildEnvVars(integrations) {
  const envVars = [
    { name: "NEXT_PUBLIC_SUPABASE_URL", scope: "public", required: true, valueExposed: false },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", scope: "public", required: true, valueExposed: false },
    { name: "SUPABASE_SERVICE_ROLE_KEY", scope: "server-only", required: true, valueExposed: false },
  ];
  for (const i of integrations) {
    for (const s of i.secretsRequired) envVars.push({ name: s, scope: "server-only", required: false, valueExposed: false });
  }
  return envVars;
}

const MAX_DESCRIPTION = 20000;
const MAX_ENTITIES = 200;

/**
 * Build a deterministic blueprint from a project request. Pure — no I/O, no AI, no network. Fails fast at
 * the boundary on missing/oversized input.
 * NOTE: `name`, `description`, and `planGate` echo request-derived text verbatim; any UI that renders them
 * MUST HTML-escape — treat them as untrusted display strings.
 */
function buildBlueprint(request) {
  const req = request || {};
  const description = typeof req.description === "string" ? req.description : "";
  if (!description.trim()) throw new Error("blueprint-engine: a non-empty description is required");
  if (description.length > MAX_DESCRIPTION) throw new Error("blueprint-engine: description too long");
  if (Array.isArray(req.entities) && req.entities.length > MAX_ENTITIES) throw new Error("blueprint-engine: too many entities");
  const name = typeof req.name === "string" && req.name.trim() ? req.name.trim() : deriveName(description);
  const projectId = slug(name);

  const norm = normalize(description + " " + name);
  const padded = " " + norm + " ";

  // Stack: default unless the request names a supported override (kept minimal in F1).
  const stack = { ...DEFAULT_STACK };
  if (/\bvite\b/.test(norm) || /\bspa\b/.test(norm)) stack.frontend = "vite";

  // Data model + pages from a domain heuristic, plus any caller-supplied explicit entities.
  const domain = detectDomain(norm, padded);
  const { entities, pages } = resolveDataModel(domain, req);

  const integrations = detectIntegrations(norm, padded);
  const refusedIntegrations = detectRefusedIntegrations(norm, padded);
  // Auth is implied whenever the app has per-user data; default it on for domains with a user concept.
  if (!integrations.some((i) => i.id === "auth") && (domain && ["crm", "shop", "booking", "todo"].includes(domain.key))) {
    integrations.unshift({ id: "auth", why: "implied by per-user data", secretsRequired: [], ownerGated: false });
  }

  // API contracts: one CRUD contract per entity (auth-guarded), derived deterministically.
  const apiContracts = entities.map((e) => ({
    resource: e.name,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    path: "/api/" + slug(e.name),
    auth: "required",
  }));

  const envVars = buildEnvVars(integrations);

  const governance = {
    productionFrozen: true,
    autoAllowed: ["scaffold", "write-file-local", "install-deps", "run-local-test", "build", "generate-report"],
    ownerGated: ["deploy", "live-database", "real-secret", "provider-call", "payment", "git-push"],
    prohibited: ["anthropic-api", "openai-api", "metered-llm-api", "deploy-production", "mutate-production-db", "send-external", "process-payment", "force-push", "expose-secret"],
  };

  return {
    schemaVersion: "1.0.0",
    projectId,
    name,
    description: description.trim(),
    stack,
    pages,
    dataModel: { entities, relations: [] },
    apiContracts,
    integrations,
    refusedIntegrations,
    envVars,
    governance,
    planGate: renderPlanGate({ name, stack, pages, entities, integrations, refusedIntegrations, envVars }),
  };
}

function deriveName(description) {
  const words = normalize(description).split(" ").filter(Boolean).slice(0, 3);
  return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : "App";
}

/** Plain-language, owner-facing summary of what would be built. Deterministic. No secret values. */
function renderPlanGate(b) {
  const lines = [];
  lines.push("Project: " + b.name);
  lines.push("Stack: " + [b.stack.frontend, b.stack.backend, b.stack.styling, b.stack.ui].join(" + "));
  lines.push("Pages: " + (b.pages.length ? b.pages.map((p) => p.name + " (" + p.path + ")").join(", ") : "none"));
  lines.push("Data: " + (b.entities.length ? b.entities.map((e) => e.name).join(", ") : "none"));
  lines.push("Integrations: " + (b.integrations.length ? b.integrations.map((i) => i.id + (i.ownerGated ? " [owner-approval]" : "")).join(", ") : "none"));
  if (b.refusedIntegrations.length) lines.push("Refused: " + b.refusedIntegrations.map((r) => r.id).join(", ") + " (no metered AI API)");
  lines.push("Secrets needed (names only, owner provides later): " + (b.envVars.filter((v) => v.scope === "server-only").map((v) => v.name).join(", ") || "none"));
  lines.push("Production: FROZEN. Deploy / live DB / real keys / payments / push require your approval.");
  return lines.join("\n");
}

module.exports = { buildBlueprint, renderPlanGate, DEFAULT_STACK, INTEGRATIONS, DOMAINS };
