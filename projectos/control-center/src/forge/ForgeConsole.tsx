/**
 * FORGE — what it is, what it can do, and what is not wired up yet.
 *
 * WHAT THIS REPLACED. This screen used to run a deterministic synthetic demo: an owner typed a build
 * command and watched "A Booking App" appear with twelve scaffolded files, a 42,000-token budget bar,
 * four passing verification checks and two snapshots. None of it happened. The engines it depicted
 * are real and their validators pass, but nothing on this screen ever called them — so the one
 * surface an owner would judge Forge by was showing invented work as though it were work.
 *
 * WHAT IT SHOWS NOW. The stages that genuinely exist as engines in `projectos/forge/`, each with the
 * validator that proves it, and a plain statement of the one thing that is missing: nothing here
 * dispatches them yet. That is Programme C. An owner reading this screen should come away knowing
 * exactly what Forge is and exactly what it cannot do today, which is the opposite of what the demo
 * taught them.
 *
 * NO NUMBERS ARE SHOWN THAT NOTHING MEASURED. There is no progress bar, no token count, no pass
 * count — because there is no run.
 */

/**
 * The pipeline as it exists in the repository. Each entry names a real module and the validator that
 * covers it; both are checked by `forgeModel.test.ts` against the filesystem, so this list cannot
 * quietly drift away from what is actually there.
 */
export interface ForgeStage {
  readonly id: string;
  readonly title: string;
  readonly what: string;
  /** The module in `projectos/forge/` that implements it. */
  readonly module: string;
  /** The validator that proves it. */
  readonly validator: string;
  /** True when performing it for real needs the owner, whatever else is delegated. */
  readonly ownerGated: boolean;
}

export const FORGE_STAGES: readonly ForgeStage[] = [
  {
    id: 'blueprint',
    title: 'Blueprint',
    what: 'Turn a description into a structured plan: pages, data, and which integrations it needs.',
    module: 'blueprint-engine.cjs',
    validator: 'validate-forge-blueprint',
    ownerGated: false,
  },
  {
    id: 'scaffold',
    title: 'Scaffold',
    what: 'Write the starting project — secure by default, with no secret in the client bundle.',
    module: 'scaffold-engine.cjs',
    validator: 'validate-forge-scaffold',
    ownerGated: false,
  },
  {
    id: 'integrations',
    title: 'Integrations',
    what: 'Wire auth, payments, email and storage from known-good playbooks.',
    module: 'integration-playbooks.cjs',
    validator: 'validate-forge-integrations',
    ownerGated: false,
  },
  {
    id: 'generation',
    title: 'Generation',
    what: 'Build features against the blueprint, within a bounded budget.',
    module: 'generation-loop.cjs',
    validator: 'validate-forge-generation',
    ownerGated: false,
  },
  {
    id: 'verify',
    title: 'Verification',
    what: 'Prove it actually works: build, tests, routes, and a real data round-trip.',
    module: 'verify-harness.cjs',
    validator: 'validate-forge-verify',
    ownerGated: false,
  },
  {
    id: 'snapshot',
    title: 'Snapshots',
    what: 'Make every step restorable, so a change that goes wrong can be rolled back.',
    module: 'env-snapshot.cjs',
    validator: 'validate-forge-snapshot',
    ownerGated: false,
  },
  {
    id: 'provision',
    title: 'Provision',
    what: 'Install, migrate and run it locally.',
    module: 'provisioner.cjs',
    validator: 'validate-forge-provisioner',
    ownerGated: true,
  },
  {
    id: 'deploy',
    title: 'Deploy',
    what: 'Put it somewhere real. Never happens without you.',
    module: 'secure-deploy-gate.cjs',
    validator: 'validate-forge-deploy',
    ownerGated: true,
  },
  {
    id: 'e2e',
    title: 'End to end',
    what: 'Run the whole pipeline as one proof.',
    module: 'forge-e2e.cjs',
    validator: 'validate-forge-e2e',
    ownerGated: true,
  },
];

export function ForgeConsole() {
  return (
    <section className="ocp fg" aria-labelledby="fg-title">
      <div className="head">
        <div>
          <h1 id="fg-title">Forge</h1>
          <p>
            Describe an app; Forge plans it, builds it and proves it — locally, and you own the
            result.
          </p>
        </div>
      </div>

      <div className="ocp-panel warn" role="status">
        <h2>Not connected to this screen yet</h2>
        <p>
          The stages below exist and each is covered by a validator that passes. What does not exist
          yet is the connection between this screen and them: nothing here starts a Forge build, and
          no build has been run from ProjectOS. Wiring that up is a programme of its own, and it has
          not started.
        </p>
        <p>
          This page previously showed a worked example — a booking app, its files, its budget and its
          passing checks. None of that had happened. It has been removed rather than relabelled.
        </p>
      </div>

      <div className="ocp-panel">
        <h2>What Forge is built to do</h2>
        <ol className="fg-stages">
          {FORGE_STAGES.map((s, i) => (
            <li className="fg-stage-row" key={s.id}>
              <span className="fg-stagenum">{String(i + 1).padStart(2, '0')}</span>
              <span className="fg-stagebody">
                <span className="fg-stagetitle">
                  {s.title}
                  {s.ownerGated && <span className="fg-gated">needs your approval</span>}
                </span>
                <span className="fg-stagewhat">{s.what}</span>
                <span className="fg-stagesrc">
                  {s.module} · {s.validator}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="ocp-panel">
        <h2>What it will never do without you</h2>
        <p>
          Provisioning, deploying, adding a real provider key and pushing to git are owner actions.
          Forge is built so those are refused rather than requested, whatever else is delegated to it.
        </p>
      </div>
    </section>
  );
}
