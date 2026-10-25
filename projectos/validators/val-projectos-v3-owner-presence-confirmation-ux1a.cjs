// Validator: PROJECTOS-V3-OWNER-PRESENCE-CONFIRMATION-UX1A
//
// Static, fail-closed structural proof that the synthetic owner-confirmation surface is ONE universal,
// no-training, fail-closed component that: never lets the renderer mint a host-only state; never renders
// a prohibited identifier; always shows the synthetic-preview banner; keeps production/critical + the
// execution-not-completed clarification visible; is 390px/reduced-motion structurally safe; and adds no
// Windows ceremony, real host write command, nonce/CSPRNG, or second approval system.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CC = path.join(ROOT, "projectos", "control-center");
const MODEL = path.join(CC, "src", "owner", "confirmation", "ownerConfirmationModel.ts");
const COMP = path.join(CC, "src", "owner", "confirmation", "ProtectedOperationConfirmation.tsx");
const FIX = path.join(CC, "src", "owner", "confirmation", "ownerConfirmationFixture.ts");
const TEST = path.join(CC, "test", "ownerPresenceConfirmation.test.tsx");
const OCP = path.join(CC, "src", "owner", "OwnerControlPlane.tsx");
const CSS = path.join(CC, "src", "styles.css");
// The surfaces that could plausibly grow a SECOND protected-operation confirmation. This named
// `OwnerChat.tsx`, which PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A Stage 8 removed by ruling; the
// entry then matched nothing and the rule silently covered one fewer surface. It is retargeted to
// the surfaces that exist now — the Control Center, which replaced the chat as the owner's command
// surface, and Connections, which gained a confirmation of its own for the native credential write.
const CONTROL_CENTER = path.join(CC, "src", "ux", "ControlCenter.tsx");
const CONNECTIONS = path.join(CC, "src", "ux", "Connections.tsx");
const FORGE = path.join(CC, "src", "forge", "ForgeConsole.tsx");

const read = (p) => fs.readFileSync(p, "utf8");
const HOST_ONLY = ["WindowsVerificationRequired", "VerificationInProgress", "Verified", "ReadyForGovernedExecution", "Expired", "Invalidated", "Unavailable"];
const PROHIBITED = ["nonce", "proofId", "operationDigest", "summaryDigest", "credential", "token", "biometric"];

function run() {
  const e = [];
  for (const [p, label] of [[MODEL, "model"], [COMP, "component"], [FIX, "fixture"], [TEST, "test"], [OCP, "OwnerControlPlane"], [CSS, "styles.css"]]) {
    if (!fs.existsSync(p)) { e.push("missing required file: " + label + " (" + p + ")"); }
  }
  if (e.length) return e;

  const model = read(MODEL);
  const comp = read(COMP);
  const fix = read(FIX);
  const test = read(TEST);
  const ocp = read(OCP);
  const css = read(CSS);

  // 1. Model exports the fail-closed machine + guards.
  for (const sym of ["reduceIntent", "reduceHostEvent", "approveBlockReason", "canApprove", "HOST_ONLY_STATES", "PROHIBITED_SUMMARY_KEYS", "CONFIRM_COPY", "FIELD_CLASSIFICATION"])
    if (!new RegExp("export (function |const )" + sym + "\\b").test(model)) e.push("model does not export " + sym);

  // 2. CORE SECURITY INVARIANT: reduceIntent (renderer path) never RETURNS a host-only state. The
  //    exhaustive behavioural proof (all states x all intents) is the runtime test asserted in check 10;
  //    reduceIntent legitimately COMPARES against host-only states in guards, so a literal-absence check
  //    would false-positive. Here we structurally confirm the Approve path routes through the
  //    submitting state and that the host-only set exists.
  const riStart = model.indexOf("export function reduceIntent");
  const riEnd = model.indexOf("export function reduceHostEvent");
  const riBody = riStart !== -1 && riEnd !== -1 ? model.slice(riStart, riEnd) : "";
  if (!riBody) e.push("cannot locate reduceIntent body");
  else if (!/'DecisionSubmitting'/.test(riBody)) e.push("reduceIntent Approve path does not go through DecisionSubmitting");
  if (!new RegExp("HOST_ONLY_STATES[^\\n]*Set").test(model)) e.push("HOST_ONLY_STATES is not a set of host-only states");

  // 3. Required copy keys (no-training, non-coercive, execution-not-completed).
  for (const k of ["title", "production", "staging", "irreversible", "payment", "communication", "customerData", "machineConfiguration", "expiry", "windowsExplanation", "approve", "refuse", "cancel", "verified", "ready", "refused", "cancelled", "unavailable", "expired", "invalidated", "executionClarification", "requiredEvidenceBlocker", "syntheticBanner"])
    if (!new RegExp("\\b" + k + ":").test(model)) e.push("CONFIRM_COPY missing key: " + k);
  if (!/not completed yet/.test(model)) e.push("verified copy must state the action is NOT completed");
  for (const bad of ["'OK'", "'Continue'", "'Proceed'", "'Confirm'", "'Authorise'"])
    if (model.includes(": " + bad)) e.push("a decision label uses a banned ambiguous word: " + bad);

  // 4. No prohibited identifier field in the summary model or the fixture.
  for (const k of PROHIBITED) {
    if (new RegExp("\\breadonly\\s+" + k + "\\b", "i").test(model)) e.push("ProtectedOperationSummary declares prohibited field: " + k);
    if (new RegExp("\\b" + k + "\\s*:", "i").test(fix)) e.push("fixture carries prohibited field: " + k);
  }

  // 5. Component structure: synthetic banner (note), live outcome region (status/polite), Escape→Cancel only.
  if (!/role="note"/.test(comp)) e.push("synthetic-preview banner is not role=note");
  if (!/CONFIRM_COPY\.syntheticBanner/.test(comp)) e.push("component does not render the synthetic-preview banner copy");
  if (!/role="status"\s*\n?\s*aria-live="polite"/.test(comp) && !/aria-live="polite"/.test(comp)) e.push("component has no polite live status region");
  if (!/e\.key === 'Escape'/.test(comp) || !/onIntent\('Cancel'\)/.test(comp)) e.push("Escape does not map to Cancel");
  {
    // Escape handler must not approve.
    const kd = comp.indexOf("handleKeyDown");
    const kdBody = kd !== -1 ? comp.slice(kd, comp.indexOf("}", comp.indexOf("{", kd)) + 1) : "";
    if (/onIntent\('Approve'\)/.test(kdBody)) e.push("Escape handler can Approve (must never approve)");
  }
  if (!/CONFIRM_COPY\.executionClarification/.test(comp)) e.push("component does not render the execution-not-completed clarification");
  if (!/ocp-confirm-expiry"/.test(comp)) e.push("component missing expiry line");
  if (/ocp-confirm-expiry"\s+role="status"/.test(comp)) e.push("expiry line must not be role=status (collides with the lifecycle banner)");

  // 6. No Windows ceremony / write command / nonce generation / tauri invoke in the UX layer.
  for (const [src, label] of [[model, "model"], [comp, "component"], [fix, "fixture"], [ocp, "OwnerControlPlane"]]) {
    for (const banned of ["UserConsentVerifier", "@tauri-apps", "randomUUID", "getRandomValues", "crypto.", "RequestVerification", "WebAuthn", "daemon_submit", "invoke("])
      if (src.includes(banned)) e.push(label + " references a prohibited API/mechanism: " + banned);
  }

  // 7. OwnerControlPlane integrates the universal component and drops the old disabled preview.
  if (!/ProtectedOperationConfirmation/.test(ocp)) e.push("OwnerControlPlane does not use ProtectedOperationConfirmation");
  if (/Return for correction/.test(ocp)) e.push("OwnerControlPlane still contains the old disabled decision preview");
  if (/Preview — record approvals in the ProjectOS desktop app/.test(ocp)) e.push("OwnerControlPlane still contains the old preview tag");

  // 8. Styles: confirmation classes + 390px-safe media query + global reduced-motion honoured.
  if (!/\.ocp-confirm\b/.test(css)) e.push("styles.css missing .ocp-confirm surface");
  if (!/\.ocp-confirm-synthetic\b/.test(css)) e.push("styles.css missing the synthetic banner style");
  if (!/@media \(max-width: 640px\)/.test(css)) e.push("styles.css missing the 640px narrow-viewport rule");
  if (!/prefers-reduced-motion: reduce/.test(css)) e.push("styles.css missing the reduced-motion honouring block");

  // 9. ONE universal framework: the component is defined once and no second confirmation component exists.
  if ((comp.match(/export function ProtectedOperationConfirmation/g) || []).length !== 1)
    e.push("ProtectedOperationConfirmation is not defined exactly once");
  for (const [p, label] of [[CONTROL_CENTER, "ControlCenter"], [CONNECTIONS, "Connections"], [FORGE, "ForgeConsole"]]) {
    if (fs.existsSync(p)) {
      const s = read(p);
      if (/ProtectedOperationConfirmation|function .*ConfirmationDialog|Approve this action/.test(s))
        e.push(label + " introduces a second/duplicate confirmation surface");
    }
  }

  // 10. Test file exists under the runner's include root (test/**) and exercises the security invariant.
  if (!/@vitest-environment jsdom/.test(test)) e.push("test file is not jsdom-scoped");
  if (!/renderer intents never mint a host-only state/.test(test)) e.push("test file does not prove the host-only-state invariant");

  return e;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) { errs.forEach((x) => console.error("[val-projectos-v3-owner-presence-confirmation-ux1a] FAIL: " + x)); process.exit(1); }
  console.log("val-projectos-v3-owner-presence-confirmation-ux1a: PASS");
}
