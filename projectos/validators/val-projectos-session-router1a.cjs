"use strict";
/**
 * Proves the session-router, profile, preflight, environment-projection and writer-lease invariants of
 * PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A. SYNTHETIC VALUES ONLY — no real credential, no provider
 * contact, no real checkout, no process is ever spawned (the spawn function is injected).
 *
 * Invariants:
 *   1  two concurrent sessions carry different Supabase project refs, each pinned to its own project
 *   2  two concurrent sessions carry different Vercel organisation/project ids
 *   3  GH_TOKEN is session-local: each session sees only its own project's token
 *   4  the global environment is unchanged by starting, running and stopping sessions
 *   5  an inherited provider variable from another session is scrubbed, not passed through
 *   6  a wrong project identity fails closed with the exact provider blocker
 *   7  the production-operation profile does not auto-load and demands an owner permit
 *   8  a second writer on ONE checkout is refused with WRITE LEASE CONFLICT
 *   9  a second writer on a SEPARATE worktree is permitted
 *  10  a reviewer session holds no writer lease and claims no write capability
 *  11  a session that exits releases its lease and its record
 *  12  an interrupted session's lease is reclaimable only when expired AND its PID is dead
 *  13  a live PID keeps the lease held even after the heartbeat expires
 *  14  a junction/alternate spelling of one checkout cannot take a second writer lease
 *  15  every one of the nine preflight blockers is reachable, and READY is returned only when all pass
 *  16  a missing credential blocks the session before any environment is built
 *  17  `gh auth switch` (and the other global auth mutations) are refused by name
 *  18  an MCP config with a literal secret, an unknown server, or an unresolved placeholder is refused
 *  19  a failed preflight releases any lease it acquired — a blocked session never blocks the checkout
 *  20  the Supabase MCP server is structurally unavailable for production
 */

const fs = require("fs");
const path = require("path");
const scratch = require("./lib/scratch.cjs");

const { createCredentialVault } = require("../credentials/vault.cjs");
const { createMemoryCredentialStore } = require("../credentials/memory-credential-store.cjs");
const { createSessionRouter } = require("../session-router/router.cjs");
const { createLeaseStore } = require("../session-router/writer-lease.cjs");
const { evaluatePreflight, BLOCKERS } = require("../session-router/identity-preflight.cjs");
const { buildChildEnvironment, validateMcpConfig } = require("../session-router/env-projection.cjs");
const { getProfile, mintProfilePermit } = require("../session-router/session-profiles.cjs");
const { createProjectRegistry } = require("../session-router/project-registry.cjs");
const { createRegistry } = require("../providers/registry.cjs");
const github = require("../providers/github.provider.cjs");
const supabase = require("../providers/supabase.provider.cjs");

const TOKENS = {
  polygoGh: "synthetic-polygo-gh-aaaaaaaaaaaa",
  polygoSupabase: "synthetic-polygo-sb-bbbbbbbbbbbb",
  polygoVercel: "synthetic-polygo-vc-cccccccccccc",
  jdGh: "synthetic-jdtesting-gh-dddddddddd",
  jdSupabase: "synthetic-jdtesting-sb-eeeeeeeeee",
  jdVercel: "synthetic-jdtesting-vc-ffffffffff",
};

function connectionFor(projectId, canonicalRoot, refs) {
  return {
    schemaVersion: "1.0",
    projectId,
    canonicalRepositoryRoot: canonicalRoot,
    providers: ["github", "supabase", "vercel"],
    github: { repository: "synthetic-owner/" + projectId },
    supabase: { environments: { staging: { projectRef: refs.supabase } } },
    vercel: { organisationId: refs.vercelOrg, environments: { staging: { projectId: refs.vercelProject } } },
  };
}

function observationsFor(connection) {
  return {
    github: { apiRepositoryFullName: connection.github.repository, remoteRepositoryFullName: connection.github.repository },
    supabase: { projectRef: connection.supabase.environments.staging.projectRef },
    vercel: { organisationId: connection.vercel.organisationId, projectId: connection.vercel.environments.staging.projectId },
  };
}

/** A stand-in child process: records the environment it was given and can be told to exit. */
function fakeSpawn(record) {
  return (command, args, options) => {
    const handlers = {};
    record.push({ command, args, env: options.env, cwd: options.cwd });
    return { pid: 4242, on: (event, fn) => { handlers[event] = fn; }, exit: () => handlers.exit && handlers.exit(0) };
  };
}

function setup(dir, projectId, refs) {
  const checkout = path.join(dir, projectId);
  fs.mkdirSync(checkout, { recursive: true });
  const canonicalRoot = process.platform === "win32" ? fs.realpathSync.native(checkout).toLowerCase() : fs.realpathSync(checkout);
  const connection = connectionFor(projectId, canonicalRoot, refs);
  const repository = { checkoutPath: checkout, canonicalRoot, branch: "main", remoteUrl: null, remoteRepositoryFullName: connection.github.repository };
  return { checkout, canonicalRoot, connection, repository };
}

function run() {
  const errors = [];
  scratch.withScratch("session-router", (dir) => {
    const stateDir = path.join(dir, "state");
    const store = createMemoryCredentialStore({ acknowledgedNonPersistent: true });
    const vault = createCredentialVault({ store, stateDir });

    const polygo = setup(dir, "polygo", { supabase: "polygostagingrefaaaa", vercelOrg: "team_POLYGO_ORG", vercelProject: "prj_POLYGO_STAGING" });
    const jd = setup(dir, "jdtesting", { supabase: "jdteststagingrefaaaa", vercelOrg: "team_JDTEST_ORG", vercelProject: "prj_JDTEST_STAGING" });

    for (const [reference, value] of [
      ["ProjectOS/polygo/staging/github/gh-token", TOKENS.polygoGh],
      ["ProjectOS/polygo/staging/supabase/supabase-access-token", TOKENS.polygoSupabase],
      ["ProjectOS/polygo/staging/vercel/vercel-token", TOKENS.polygoVercel],
      ["ProjectOS/jdtesting/staging/github/gh-token", TOKENS.jdGh],
      ["ProjectOS/jdtesting/staging/supabase/supabase-access-token", TOKENS.jdSupabase],
      ["ProjectOS/jdtesting/staging/vercel/vercel-token", TOKENS.jdVercel],
    ]) vault.provision({ reference, readValue: () => value });

    // The owner registry is the out-of-checkout trust anchor. Register each project exactly as the owner
    // would; nothing below can start a session without it.
    const projectRegistry = createProjectRegistry({ stateDir });
    for (const s of [polygo, jd]) {
      projectRegistry.register({ connection: s.connection, checkoutPath: s.checkout, capability: { ownerConfirmation: true } });
    }

    const spawned = [];
    const router = createSessionRouter({ vault, stateDir, projectRegistry, spawn: fakeSpawn(spawned) });

    const envBefore = JSON.stringify(process.env);

    // A base environment already polluted with ANOTHER project's provider state.
    const pollutedBase = { PATH: "/usr/bin", GH_TOKEN: "synthetic-someone-elses-token-xx", SUPABASE_PROJECT_REF: "someoneelserefaaaaaa", HOME: "/home/test" };

    const startFor = (slot, s, base) => router.start({
      slot,
      profileName: "staging-writer",
      environment: "staging",
      checkoutPath: s.checkout,
      connection: s.connection,
      repository: s.repository,
      observations: observationsFor(s.connection),
      command: "node",
      args: ["--version"],
      baseEnv: base,
    });

    const polygoSession = startFor("polygo-1", polygo, pollutedBase);
    const jdSession = startFor("jdtesting-1", jd, pollutedBase);

    if (!polygoSession.ready) errors.push("invariant 1: the PolyGo session was not READY — " + polygoSession.blocker + " " + polygoSession.detail);
    if (!jdSession.ready) errors.push("invariant 1: the JD Testing session was not READY — " + jdSession.blocker + " " + jdSession.detail);

    const polygoEnv = spawned[0] ? spawned[0].env : {};
    const jdEnv = spawned[1] ? spawned[1].env : {};

    // 1 / 2: concurrent sessions carry different, correctly pinned provider identities.
    if (polygoEnv.SUPABASE_PROJECT_REF !== "polygostagingrefaaaa" || jdEnv.SUPABASE_PROJECT_REF !== "jdteststagingrefaaaa") {
      errors.push("invariant 1: concurrent sessions did not carry their own Supabase project refs");
    }
    if (polygoEnv.VERCEL_PROJECT_ID !== "prj_POLYGO_STAGING" || jdEnv.VERCEL_PROJECT_ID !== "prj_JDTEST_STAGING" || polygoEnv.VERCEL_ORG_ID === jdEnv.VERCEL_ORG_ID) {
      errors.push("invariant 2: concurrent sessions did not carry their own Vercel organisation/project ids");
    }

    // 3: GH_TOKEN is session-local.
    if (polygoEnv.GH_TOKEN !== TOKENS.polygoGh) errors.push("invariant 3: the PolyGo session did not receive its own GH_TOKEN");
    if (jdEnv.GH_TOKEN !== TOKENS.jdGh) errors.push("invariant 3: the JD Testing session did not receive its own GH_TOKEN");
    if (polygoEnv.GH_TOKEN === jdEnv.GH_TOKEN) errors.push("invariant 3: two sessions share one GH_TOKEN");
    for (const [name, env] of [["polygo", polygoEnv], ["jdtesting", jdEnv]]) {
      const foreign = name === "polygo" ? [TOKENS.jdGh, TOKENS.jdSupabase, TOKENS.jdVercel] : [TOKENS.polygoGh, TOKENS.polygoSupabase, TOKENS.polygoVercel];
      const text = JSON.stringify(env);
      for (const value of foreign) if (text.includes(value)) errors.push("invariant 3: the " + name + " session environment carried another project's credential");
    }

    // 4: nothing global changed.
    if (JSON.stringify(process.env) !== envBefore) errors.push("invariant 4: process.env was modified by the session router");

    // 5: inherited provider state is scrubbed.
    if (polygoEnv.GH_TOKEN === pollutedBase.GH_TOKEN) errors.push("invariant 5: an inherited GH_TOKEN survived into the session");
    if (polygoEnv.SUPABASE_PROJECT_REF === pollutedBase.SUPABASE_PROJECT_REF) errors.push("invariant 5: an inherited SUPABASE_PROJECT_REF survived into the session");
    const scrubOnly = buildChildEnvironment({ baseEnv: pollutedBase, providerEnvVars: createRegistry().allEnvVars(), contributions: {} });
    if (Object.prototype.hasOwnProperty.call(scrubOnly.env, "GH_TOKEN")) errors.push("invariant 5: the scrub did not remove an unrequested provider variable");
    if (scrubOnly.env.PATH !== "/usr/bin") errors.push("invariant 5: the scrub removed a non-provider variable");

    // 6: wrong project identity fails closed with the provider's own blocker.
    const swapped = router.prepare({
      slot: "polygo-2", profileName: "readonly-reviewer", environment: "staging",
      checkoutPath: polygo.checkout, connection: polygo.connection, repository: polygo.repository,
      observations: { ...observationsFor(polygo.connection), supabase: { projectRef: "jdteststagingrefaaaa" } },
    });
    if (swapped.blocker !== "SUPABASE PROJECT MISMATCH") errors.push("invariant 6: a swapped Supabase ref did not produce SUPABASE PROJECT MISMATCH (got " + String(swapped.blocker) + ")");

    // 6b: a DECLARED provider with no observation at all must be a mismatch, never a pass. This is the
    // difference between "verified" and "nobody looked".
    for (const [provider, blocker] of [["github", "GITHUB IDENTITY MISMATCH"], ["supabase", "SUPABASE PROJECT MISMATCH"], ["vercel", "VERCEL PROJECT MISMATCH"]]) {
      const partial = { ...observationsFor(polygo.connection) };
      delete partial[provider];
      const unobserved = router.prepare({
        slot: "polygo-2", profileName: "readonly-reviewer", environment: "staging",
        checkoutPath: polygo.checkout, connection: polygo.connection, repository: polygo.repository,
        observations: partial,
      });
      if (unobserved.blocker !== blocker) errors.push("invariant 6b: an unobserved " + provider + " identity did not produce " + blocker + " (got " + String(unobserved.blocker) + ")");
    }

    // 7: production-operation does not auto-load.
    const productionAttempt = router.prepare({
      slot: "polygo-3", profileName: "production-operation", environment: "production",
      checkoutPath: polygo.checkout, connection: polygo.connection, repository: polygo.repository, observations: {},
    });
    if (productionAttempt.blocker !== "OWNER PERMIT REQUIRED") errors.push("invariant 7: production-operation auto-loaded (got " + String(productionAttempt.blocker) + ")");
    if (getProfile("production-operation").autoLoadable !== false) errors.push("invariant 7: production-operation is marked auto-loadable");

    // 8: a second writer on the SAME checkout is refused.
    const secondWriter = router.prepare({
      slot: "polygo-4", profileName: "staging-writer", environment: "staging",
      checkoutPath: polygo.checkout, connection: polygo.connection, repository: polygo.repository,
      observations: observationsFor(polygo.connection),
    });
    if (secondWriter.blocker !== "WRITE LEASE CONFLICT") errors.push("invariant 8: a second writer on one checkout was not refused (got " + String(secondWriter.blocker) + ")");

    // 9: a second writer on a SEPARATE worktree is permitted.
    const worktree = setup(dir, "polygo-worktree", { supabase: "polygostagingrefaaaa", vercelOrg: "team_POLYGO_ORG", vercelProject: "prj_POLYGO_STAGING" });
    const worktreeConnection = { ...worktree.connection, projectId: "polygo", github: polygo.connection.github, supabase: polygo.connection.supabase, vercel: polygo.connection.vercel };
    // A second worktree is a second registered ROOT for the same project — the owner adds it explicitly.
    projectRegistry.register({ connection: worktreeConnection, checkoutPath: worktree.checkout, capability: { ownerConfirmation: true } });
    const secondWorktree = router.prepare({
      slot: "polygo-5", profileName: "staging-writer", environment: "staging",
      checkoutPath: worktree.checkout, connection: worktreeConnection, repository: worktree.repository,
      observations: observationsFor(worktreeConnection),
    });
    if (!secondWorktree.ready) errors.push("invariant 9: a second writer in a separate worktree was refused — " + String(secondWorktree.blocker));
    router.leases.release({ checkoutPath: worktree.checkout, sessionId: secondWorktree.sessionId });

    // 10: a reviewer session holds no lease and claims no write capability.
    const reviewer = router.prepare({
      slot: "polygo-6", profileName: "readonly-reviewer", environment: "staging",
      checkoutPath: polygo.checkout, connection: polygo.connection, repository: polygo.repository,
      observations: observationsFor(polygo.connection),
    });
    if (!reviewer.ready) errors.push("invariant 10: a reviewer could not join a checkout already held by a writer — " + String(reviewer.blocker));
    if (reviewer.leaseHeld !== false) errors.push("invariant 10: the reviewer took a writer lease");
    const reviewerProfile = getProfile("readonly-reviewer");
    if (reviewerProfile.capabilities.repositoryWrite || reviewerProfile.capabilities.providerWrite || reviewerProfile.capabilities.deploy || reviewerProfile.capabilities.migrate) {
      errors.push("invariant 10: the reviewer profile claims a write capability");
    }

    // 11: a child exit releases the lease and the record.
    const child = polygoSession.child;
    if (!child) errors.push("invariant 11: no child was created for the PolyGo session");
    else {
      child.exit();
      if (router.status({ slot: "polygo-1" }).length !== 0) errors.push("invariant 11: the session record survived the child's exit");
      const afterExit = router.prepare({
        slot: "polygo-7", profileName: "staging-writer", environment: "staging",
        checkoutPath: polygo.checkout, connection: polygo.connection, repository: polygo.repository,
        observations: observationsFor(polygo.connection),
      });
      if (!afterExit.ready) errors.push("invariant 11: the writer lease was not released when the child exited — " + String(afterExit.blocker));
      router.leases.release({ checkoutPath: polygo.checkout, sessionId: afterExit.sessionId });
    }

    // 12 / 13: staleness needs BOTH an expired heartbeat and a dead PID.
    const interruptedDir = path.join(dir, "interrupted");
    fs.mkdirSync(interruptedDir, { recursive: true });
    let clock = 1000;
    const deadPidLeases = createLeaseStore({ leaseDir: path.join(stateDir, "leases-stale"), ttlMs: 10, nowMs: () => clock, isProcessAlive: () => false });
    const first = deadPidLeases.acquire({ projectId: "polygo", checkoutPath: interruptedDir, sessionId: "sess_interrupted" });
    if (!first.ok) errors.push("invariant 12: could not take the first lease");
    clock += 1000;
    const reclaimed = deadPidLeases.acquire({ projectId: "polygo", checkoutPath: interruptedDir, sessionId: "sess_new" });
    if (!reclaimed.ok || reclaimed.lease.reclaimedFromSessionId !== "sess_interrupted") errors.push("invariant 12: an expired lease with a dead PID was not reclaimed");

    let clock2 = 1000;
    const liveLeases = createLeaseStore({ leaseDir: path.join(stateDir, "leases-live"), ttlMs: 10, nowMs: () => clock2, isProcessAlive: () => true });
    liveLeases.acquire({ projectId: "polygo", checkoutPath: interruptedDir, sessionId: "sess_live" });
    clock2 += 1000;
    const blocked = liveLeases.acquire({ projectId: "polygo", checkoutPath: interruptedDir, sessionId: "sess_other" });
    if (blocked.ok !== false || blocked.reason !== "WRITE LEASE CONFLICT") errors.push("invariant 13: an expired heartbeat with a LIVE pid was wrongly reclaimed");

    // 14: a junction (or, failing that, a differently-cased spelling) of one checkout maps to the SAME
    // lease. This is the check that makes the one-writer rule real rather than string-deep.
    const viaAlternate = createLeaseStore({ leaseDir: path.join(stateDir, "leases-alt"), nowMs: () => 1 });
    viaAlternate.acquire({ projectId: "polygo", checkoutPath: polygo.checkout, sessionId: "sess_a" });
    const junction = path.join(dir, "polygo-junction");
    let alternate = null;
    let alternateKind = null;
    try {
      fs.symlinkSync(polygo.checkout, junction, process.platform === "win32" ? "junction" : "dir");
      alternate = junction;
      alternateKind = "junction";
    } catch (e) {
      // Creating a reparse point can be denied by policy; fall back to a case variation, which exercises
      // the same canonicalisation path on Windows.
      alternate = process.platform === "win32" ? polygo.checkout.toUpperCase() : null;
      alternateKind = alternate ? "case-variation" : null;
    }
    if (!alternate) errors.push("invariant 14: no alternate spelling could be constructed on this platform — the canonicalisation check did not run");
    else {
      const alternateAttempt = viaAlternate.acquire({ projectId: "polygo", checkoutPath: alternate, sessionId: "sess_b" });
      if (alternateAttempt.ok !== false) errors.push("invariant 14: a " + alternateKind + " of the same checkout took a second writer lease");
      const canonicalViaAlternate = viaAlternate.canonicalRoot(alternate);
      if (canonicalViaAlternate !== viaAlternate.canonicalRoot(polygo.checkout)) {
        errors.push("invariant 14: the " + alternateKind + " did not canonicalise to the same root");
      }
    }
    if (typeof liveLeases.inspect(interruptedDir).canonicalRepositoryRoot !== "string") errors.push("invariant 14: the canonical root could not be resolved");

    // 15: every blocker is reachable, and READY requires all checks.
    const reached = new Set();
    const baseInput = {
      connection: polygo.connection, environment: "staging", profileName: "staging-writer",
      repository: polygo.repository, observations: observationsFor(polygo.connection),
      credentials: [{ credential: "gh-token", present: true, expired: false }],
      lease: { ok: true }, registry: createRegistry(), projectRegistry,
    };
    const cases = [
      { ...baseInput, repository: { ...polygo.repository, canonicalRoot: "c:/somewhere/else" } },
      { ...baseInput, observations: { ...baseInput.observations, github: { apiRepositoryFullName: "someone/else" } } },
      { ...baseInput, observations: { ...baseInput.observations, supabase: { projectRef: "wrongstagingrefaaaaa" } } },
      { ...baseInput, observations: { ...baseInput.observations, vercel: { organisationId: "team_WRONG_ORG", projectId: "prj_WRONG" } } },
      { ...baseInput, credentials: [{ credential: "gh-token", present: false, expired: false }] },
      { ...baseInput, credentials: [{ credential: "gh-token", present: true, expired: true }] },
      { ...baseInput, lease: { ok: false, reason: "WRITE LEASE CONFLICT", heldBy: { sessionId: "s", pid: 1 } } },
      { ...baseInput, profileName: "production-operation", environment: "production" },
      { ...baseInput, profileName: "production-readonly", environment: "staging" },
    ];
    for (const input of cases) {
      const decision = evaluatePreflight(input);
      if (decision.ready) errors.push("invariant 15: a broken preflight returned READY");
      else reached.add(decision.blocker);
    }
    for (const blocker of BLOCKERS) if (!reached.has(blocker)) errors.push("invariant 15: blocker never reached: " + blocker);
    if (!evaluatePreflight(baseInput).ready) errors.push("invariant 15: a fully valid preflight did not return READY");

    // 15b: DEFENCE IN DEPTH. The owner registry is the strong anchor, but the connection's own declared
    // root must still be checked independently — otherwise removing that check would be invisible, and the
    // preflight would rely on a single control. A deliberately permissive registry proves it stands alone.
    const permissiveRegistry = { verify: () => ({ ok: true, blocker: null, detail: null }) };
    const rootOnly = evaluatePreflight({ ...baseInput, projectRegistry: permissiveRegistry, repository: { ...polygo.repository, canonicalRoot: "c:/not/this/checkout" } });
    if (rootOnly.blocker !== "REPOSITORY MISMATCH") errors.push("invariant 15b: with a permissive registry, a wrong checkout root was not independently refused");
    // ...and the preflight must refuse outright when no registry is supplied at all.
    const noRegistry = evaluatePreflight({ ...baseInput, projectRegistry: null });
    if (noRegistry.blocker !== "REPOSITORY MISMATCH") errors.push("invariant 15b: a preflight with no owner registry did not fail closed");

    // 16: a missing credential blocks before an environment is built.
    const spawnedBefore = spawned.length;
    const missingCredential = router.prepare({
      slot: "polygo-8", profileName: "staging-writer", environment: "development",
      checkoutPath: polygo.checkout, connection: polygo.connection, repository: polygo.repository,
      observations: observationsFor(polygo.connection),
    });
    if (missingCredential.blocker !== "CREDENTIAL MISSING") errors.push("invariant 16: a missing credential did not block the session (got " + String(missingCredential.blocker) + ")");
    if (spawned.length !== spawnedBefore) errors.push("invariant 16: a child was spawned despite a missing credential");

    // 17: global GitHub auth mutation is refused by name.
    for (const command of ["gh auth switch", "GH AUTH SWITCH --user someone", "gh auth login", "gh auth logout"]) {
      if (github.assertCommandAllowed(command).allowed !== false) errors.push("invariant 17: '" + command + "' was not refused");
    }
    if (github.assertCommandAllowed("gh repo view").allowed !== true) errors.push("invariant 17: an ordinary gh command was wrongly refused");

    // 18: MCP config hygiene.
    const literal = validateMcpConfig({ mcpConfig: { mcpServers: { github: { env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_" + "a".repeat(36) } } } }, env: {}, allowedServers: ["github"] });
    if (literal.ok || !literal.literalSecrets.length) errors.push("invariant 18: a literal secret in an MCP config was not refused");
    const unknownServer = validateMcpConfig({ mcpConfig: { mcpServers: { mystery: {} } }, env: {}, allowedServers: ["github"] });
    if (unknownServer.ok || !unknownServer.disallowedServers.includes("mystery")) errors.push("invariant 18: an unknown MCP server was not refused");
    const unresolved = validateMcpConfig({ mcpConfig: { mcpServers: { github: { env: { T: "${GH_TOKEN}" } } } }, env: {}, allowedServers: ["github"] });
    if (unresolved.ok || !unresolved.missingPlaceholders.includes("GH_TOKEN")) errors.push("invariant 18: an unresolved placeholder was not refused");
    const resolved = validateMcpConfig({ mcpConfig: { mcpServers: { github: { env: { T: "${GH_TOKEN}" } } } }, env: { GH_TOKEN: TOKENS.polygoGh }, allowedServers: ["github"] });
    if (!resolved.ok) errors.push("invariant 18: a correct MCP config was rejected");

    // 19: a failed preflight leaves no lease behind.
    const blockedWriter = router.prepare({
      slot: "polygo-9", profileName: "staging-writer", environment: "staging",
      checkoutPath: jd.checkout, connection: jd.connection, repository: jd.repository,
      observations: { ...observationsFor(jd.connection), vercel: { organisationId: "team_WRONG_ORG", projectId: "prj_WRONG" } },
    });
    if (blockedWriter.blocker !== "VERCEL PROJECT MISMATCH") errors.push("invariant 19: expected VERCEL PROJECT MISMATCH, got " + String(blockedWriter.blocker));
    const jdLease = router.leases.inspect(jd.checkout);
    if (jdLease.held && jdLease.held.sessionId === blockedWriter.sessionId) errors.push("invariant 19: a blocked session left its writer lease in place");

    // 20: production Supabase MCP is structurally unavailable.
    if (supabase.mcpEnabledFor("production") !== false) errors.push("invariant 20: the Supabase MCP server is enabled for production");
    if (supabase.mcpEnabledFor("staging") !== true) errors.push("invariant 20: the Supabase MCP server is not available for staging");
    if (getProfile("production-readonly").mcpServers.includes("supabase")) errors.push("invariant 20: the production-readonly profile lists the Supabase MCP server");

    // 21: an UNREGISTERED project is refused. Without the owner registry the only "proof" of identity
    // would be the checkout's own file, which a forged checkout writes itself.
    const stranger = setup(dir, "stranger", { supabase: "strangerstagingrefaa", vercelOrg: "team_STRANGER_ORG", vercelProject: "prj_STRANGER" });
    const unregistered = router.prepare({
      slot: "stranger-1", profileName: "readonly-reviewer", environment: "staging",
      checkoutPath: stranger.checkout, connection: stranger.connection, repository: stranger.repository,
      observations: observationsFor(stranger.connection),
    });
    if (unregistered.blocker !== "REPOSITORY MISMATCH") errors.push("invariant 21: an unregistered project was not refused (got " + String(unregistered.blocker) + ")");

    // 22: a FORGED checkout that claims a registered project's id is refused — its root is not registered.
    const forged = setup(dir, "forged", { supabase: "polygostagingrefaaaa", vercelOrg: "team_POLYGO_ORG", vercelProject: "prj_POLYGO_STAGING" });
    const forgedConnection = { ...forged.connection, projectId: "polygo", github: polygo.connection.github, supabase: polygo.connection.supabase, vercel: polygo.connection.vercel };
    const forgedAttempt = router.prepare({
      slot: "polygo-forged", profileName: "readonly-reviewer", environment: "staging",
      checkoutPath: forged.checkout, connection: forgedConnection, repository: forged.repository,
      observations: observationsFor(forgedConnection),
    });
    if (forgedAttempt.blocker !== "REPOSITORY MISMATCH") errors.push("invariant 22: a forged checkout claiming a registered project was not refused (got " + String(forgedAttempt.blocker) + ")");

    // 23: a registered checkout that later rewrites its own declared GitHub repository is refused.
    const rewritten = { ...polygo.connection, github: { repository: "attacker-owner/attacker-repo" } };
    const rewrittenAttempt = router.prepare({
      slot: "polygo-rewritten", profileName: "readonly-reviewer", environment: "staging",
      checkoutPath: polygo.checkout, connection: rewritten, repository: polygo.repository,
      observations: observationsFor(rewritten),
    });
    if (rewrittenAttempt.blocker !== "GITHUB IDENTITY MISMATCH") errors.push("invariant 23: a rewritten in-checkout GitHub repository was not refused (got " + String(rewrittenAttempt.blocker) + ")");

    // 24: production-operation IS reachable with a valid owner session permit, and not with an expired one.
    const prod = setup(dir, "prodproject", { supabase: "prodstagingrefaaaaaa", vercelOrg: "team_PROD_ORG", vercelProject: "prj_PROD" });
    const prodConnection = { ...prod.connection, providers: ["github"] };
    projectRegistry.register({ connection: prodConnection, checkoutPath: prod.checkout, capability: { ownerConfirmation: true } });
    const prodObservations = { github: { apiRepositoryFullName: prodConnection.github.repository, remoteRepositoryFullName: prodConnection.github.repository } };
    const validPermit = mintProfilePermit({ projectId: prodConnection.projectId, environment: "production", profile: "production-operation", capability: { ownerConfirmation: true } });
    const permitted = router.prepare({
      slot: "prod-1", profileName: "production-operation", environment: "production",
      checkoutPath: prod.checkout, connection: prodConnection, repository: prod.repository,
      observations: prodObservations, permit: validPermit,
    });
    if (!permitted.ready) errors.push("invariant 24: a valid owner session permit did not admit production-operation — " + String(permitted.blocker) + " " + String(permitted.detail));
    else router.leases.release({ checkoutPath: prod.checkout, sessionId: permitted.sessionId });
    const expiredPermit = { ...validPermit, expiresAtMs: 1 };
    const expired = router.prepare({
      slot: "prod-2", profileName: "production-operation", environment: "production",
      checkoutPath: prod.checkout, connection: prodConnection, repository: prod.repository,
      observations: prodObservations, permit: expiredPermit,
    });
    if (expired.blocker !== "OWNER PERMIT REQUIRED") errors.push("invariant 24: an expired session permit was accepted (got " + String(expired.blocker) + ")");
    let unconfirmedRefused = false;
    try { mintProfilePermit({ projectId: prodConnection.projectId, environment: "production", profile: "production-operation", capability: {} }); }
    catch (e) { unconfirmedRefused = String(e.message).includes("OWNER PERMIT REQUIRED"); }
    if (!unconfirmedRefused) errors.push("invariant 24: a session permit was minted without owner confirmation");

    // 25: a machine-global auth mutation supplied as the session command is refused AT START, and the
    // writer lease it would have taken is released rather than stranded.
    const beforeSpawn = spawned.length;
    const vetoed = router.start({
      slot: "polygo-veto", profileName: "staging-writer", environment: "staging",
      checkoutPath: worktree.checkout, connection: worktreeConnection, repository: worktree.repository,
      observations: observationsFor(worktreeConnection), command: "gh", args: ["auth", "switch", "--user", "someone"],
      baseEnv: pollutedBase,
    });
    if (vetoed.ready !== false) errors.push("invariant 25: 'gh auth switch' was accepted as a session command");
    if (spawned.length !== beforeSpawn) errors.push("invariant 25: a vetoed command was spawned");
    const worktreeLease = router.leases.inspect(worktree.checkout);
    if (worktreeLease.held && !worktreeLease.stale) errors.push("invariant 25: a vetoed session left its writer lease in place");

    // 26: MCP configuration is enforced by the REAL session-start path, not merely unit-tested.
    //     validateMcpConfig having no runtime call site was a live defect: the docs promised a
    //     session-start refusal that no code performed. These checks pin the call site, its position
    //     BEFORE any credential is retrieved or any child is spawned, and every refusal reason.
    const mcpBase = {
      slot: 'polygo-mcp', environment: 'staging', profileName: 'staging-writer',
      checkoutPath: polygo.checkout, connection: polygo.connection, repository: polygo.repository,
      observations: observationsFor(polygo.connection),
    };
    const goodMcp = { mcpServers: { github: { env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GH_TOKEN}' } } } };

    // A10 / A11 — a valid config lets the remaining preflight run and READY remains reachable.
    const mcpOk = router.prepare({ ...mcpBase, mcpConfig: goodMcp });
    if (mcpOk.blocker === 'MCP CONFIG INVALID') errors.push('invariant 26: a valid MCP config was refused: ' + mcpOk.detail);
    if (mcpOk.ready !== true) errors.push('invariant 26: a valid MCP config did not reach READY: ' + mcpOk.blocker);
    // prepare() acquires the writer lease; only a STARTED session is released by stop(), so release the
    // lease this successful prepare took, exactly as the neighbouring invariants do.
    if (mcpOk.ready === true && mcpOk.leaseHeld) router.leases.release({ checkoutPath: polygo.checkout, sessionId: mcpOk.sessionId });

    // A8 — an unresolved placeholder refuses the session.
    const spawnedBeforeMcp = spawned.length;
    const unresolvedRun = router.prepare({ ...mcpBase, mcpConfig: { mcpServers: { github: { env: { T: '${NO_SUCH_VAR}' } } } } });
    if (unresolvedRun.blocker !== 'MCP CONFIG INVALID') errors.push('invariant 26: an unresolved MCP placeholder did not refuse the session');
    if (unresolvedRun.ready !== false) errors.push('invariant 26: READY was emitted despite an unresolved MCP placeholder');

    // A9 — a malformed configuration refuses the session.
    const malformed = router.prepare({ ...mcpBase, mcpConfig: { mcpServers: { github: { env: { GH_TOKEN: 'ghp_' + 'a'.repeat(36) } } } } });
    if (malformed.blocker !== 'MCP CONFIG INVALID') errors.push('invariant 26: a literal secret in the MCP config did not refuse the session');

    // A9 — a server this project does not declare refuses the session.
    const wrongServer = router.prepare({ ...mcpBase, mcpConfig: { mcpServers: { somebodyElse: {} } } });
    if (wrongServer.blocker !== 'MCP CONFIG INVALID') errors.push('invariant 26: an undeclared MCP server did not refuse the session');

    // A7 — no child process was launched by any refused session.
    if (spawned.length !== spawnedBeforeMcp) errors.push('invariant 26: a refused MCP session spawned a child process');

    // A7 — and no writer lease was left behind by the refusals.
    const mcpLease = router.leases.inspect(polygo.checkout);
    if (mcpLease.held && !mcpLease.stale) errors.push('invariant 26: a refused MCP session left its writer lease in place');

    // A6 — the call site really is the router, not just the validator: refusing on a config the router
    //      itself loaded from the checkout proves the wiring, not merely the exported function.
    const mcpDir = path.join(polygo.checkout, '.projectops');
    fs.mkdirSync(mcpDir, { recursive: true });
    const mcpFile = path.join(mcpDir, 'mcp.json');
    fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { github: { env: { T: '${NO_SUCH_VAR}' } } } }), 'utf8');
    const fromDisk = router.prepare({ ...mcpBase });
    if (fromDisk.blocker !== 'MCP CONFIG INVALID') errors.push('invariant 26: .projectops/mcp.json on disk was not validated at session start');
    fs.writeFileSync(mcpFile, '{ not json', 'utf8');
    const unparseable = router.prepare({ ...mcpBase });
    if (unparseable.blocker !== 'MCP CONFIG INVALID') errors.push('invariant 26: an unparseable .projectops/mcp.json did not refuse the session');
    fs.rmSync(mcpFile, { force: true });

    // Tidy every lease this validator still holds so a re-run starts clean.
    for (const record of router.status({})) router.stop({ slot: record.slot });
  });
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("val-projectos-session-router1a: " + e.length + " error(s)"); process.exit(1); }
  console.log("val-projectos-session-router1a: PASS");
}
module.exports = { run };
