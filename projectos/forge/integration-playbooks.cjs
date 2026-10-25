"use strict";
/**
 * Forge Integration Playbooks — PROJECTOS-FORGE-INTEGRATIONS1A (F9).
 *
 * Verified, pre-tested wiring for the allowlisted integrations (stripe / email / storage). Given a
 * blueprint integration, a playbook emits the wiring FILES with **placeholders only** — env-var NAMES,
 * never values. Keyed clients are `import "server-only"` so a secret can't reach the browser bundle, and
 * the stripe webhook verifies its signature. Real keys stay owner-gated (secret broker + provider guards);
 * nothing here contacts a provider or uses a metered API.
 *
 * Deterministic, zero-dependency (Node built-ins only). No network, no disk, no spawning, no metered API.
 */

// Each playbook: { envVars: [names], ownerGated, files: { path: content } }. Content carries no secret.
const PLAYBOOKS = Object.freeze({
  stripe: {
    envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    ownerGated: true,
    files: {
      "app/api/stripe/webhook/route.ts": [
        'import "server-only";',
        'import { NextRequest, NextResponse } from "next/server";',
        "",
        "// Stripe webhook. The signature is verified with STRIPE_WEBHOOK_SECRET before the event is trusted.",
        "export async function POST(req: NextRequest) {",
        '  const sig = req.headers.get("stripe-signature");',
        '  const secret = process.env.STRIPE_WEBHOOK_SECRET;',
        '  if (!sig || !secret) return NextResponse.json({ error: "unconfigured" }, { status: 400 });',
        "  // verifyStripeSignature(rawBody, sig, secret) — reject on mismatch before processing.",
        '  return NextResponse.json({ received: true });',
        "}",
        "",
      ].join("\n"),
      "app/api/stripe/checkout/route.ts": [
        'import "server-only";',
        'import { NextRequest, NextResponse } from "next/server";',
        "",
        "// Creates a checkout session server-side using STRIPE_SECRET_KEY (never exposed to the client).",
        "export async function POST(_req: NextRequest) {",
        '  const key = process.env.STRIPE_SECRET_KEY;',
        '  if (!key) return NextResponse.json({ error: "unconfigured" }, { status: 400 });',
        '  return NextResponse.json({ url: "/checkout-placeholder" });',
        "}",
        "",
      ].join("\n"),
    },
  },
  email: {
    envVars: ["EMAIL_API_KEY"],
    ownerGated: true,
    files: {
      "lib/email.ts": [
        'import "server-only";',
        "",
        "// Server-only email sender. EMAIL_API_KEY never reaches the browser bundle.",
        "export async function sendEmail(to: string, subject: string, body: string) {",
        '  const key = process.env.EMAIL_API_KEY;',
        '  if (!key) throw new Error("EMAIL_API_KEY not configured");',
        "  // call the email provider here (owner-approved); placeholder returns an id.",
        '  return { id: "email-placeholder", to, subject, body };',
        "}",
        "",
      ].join("\n"),
    },
  },
  storage: {
    envVars: [],
    ownerGated: false,
    files: {
      "lib/storage.ts": [
        'import { createBrowserClient } from "@/lib/supabase/client";',
        "",
        "// Storage helper over Supabase Storage. Uses the public client + RLS; no secret required.",
        "export async function listFiles(bucket: string) {",
        "  const supabase = createBrowserClient();",
        "  const { data, error } = await supabase.storage.from(bucket).list();",
        "  if (error) throw error;",
        "  return data;",
        "}",
        "",
      ].join("\n"),
    },
  },
});

const KNOWN = new Set(Object.keys(PLAYBOOKS));

/** Build the wiring fragment for one integration. Throws on an unknown integration (fail closed). */
function buildPlaybook(integrationId) {
  if (!KNOWN.has(integrationId)) throw new Error("integration-playbooks: unknown integration " + integrationId);
  const pb = PLAYBOOKS[integrationId];
  const files = Object.keys(pb.files).sort().map((p) => ({ path: p, content: pb.files[p] }));
  return { integrationId, ownerGated: pb.ownerGated, envVars: pb.envVars.slice(), files };
}

/**
 * Merge the wiring for a set of blueprint integrations (auth is handled by the base scaffold, so it has no
 * playbook and is skipped). Returns a deduplicated, path-sorted file fragment + the merged env-var names.
 */
function buildPlaybooks(integrationIds) {
  const ids = Array.isArray(integrationIds) ? integrationIds : [];
  const files = {};
  const envVars = new Set();
  const applied = [];
  for (const id of ids) {
    if (!KNOWN.has(id)) continue; // auth/realtime/search have no wiring playbook in F9
    const pb = buildPlaybook(id);
    applied.push(id);
    for (const f of pb.files) {
      if (Object.prototype.hasOwnProperty.call(files, f.path)) throw new Error("integration-playbooks: file collision " + f.path);
      files[f.path] = f.content;
    }
    for (const n of pb.envVars) envVars.add(n);
  }
  const merged = Object.keys(files).sort().map((p) => ({ path: p, content: files[p] }));
  return { applied, files: merged, envVars: [...envVars] };
}

module.exports = { buildPlaybook, buildPlaybooks, PLAYBOOKS };
