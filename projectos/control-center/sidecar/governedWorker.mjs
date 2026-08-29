/**
 * ONE GOVERNED COMMAND, RUN OUT OF THE DAEMON'S EVENT LOOP.
 *
 * THE DEFECT THIS EXISTS FOR. `plan.draft --authored` calls a provider through the trusted broker,
 * and the broker is invoked with `spawnSync`. Run in-process, that blocks the sidecar's event loop
 * for the whole of the provider's latency — at least eighteen seconds on the first live call. The
 * daemon heartbeats every five seconds against a twelve-second liveness window, so a blocked sidecar
 * is indistinguishable from a dead one: the renderer concluded RUNTIME_STOPPED, the owner's panel
 * unmounted, and the result of a call that cost real money arrived at a component that no longer
 * existed. The owner saw a blank form and pressed again.
 *
 * SO THE WORK MOVES, AND NOTHING ELSE DOES. The daemon keeps answering snapshots while this process
 * does the waiting; the command itself is the same typed call against the same canonical agent.
 *
 * WHY NOT SPAWN THE CLI. Because the objective is OWNER FREE TEXT, and the CLI takes its input as
 * argv: `parseArgs` reads any token beginning with `--` as a flag name, so an objective starting
 * `--force` would have become one. The in-process design was deliberately typed for exactly that
 * reason, and moving the work off the event loop must not quietly give that up. The request arrives
 * here as JSON on stdin, ALREADY VALIDATED by the parent against the closed governed vocabulary, and
 * is applied as a typed function call. Nothing here parses a command line.
 *
 * IT DECIDES NOTHING. No verb set, no argument validation, no authority: the parent settled all of
 * that before spawning. This composes the same engines, binds the same git, calls the same function
 * and prints the agent's own CommandResult verbatim.
 *
 * Created in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A (post-live-call correction).
 */
import { plan as planCommand, nodeSystem as agentSystem, setGovernanceEngines } from '@projectos/agent';
import { gitBoundSystem } from './gitBoundSystem.mjs';

import governanceEngine from '../../validators/plan-governance-engine.cjs';
import discoveryEngine from '../../validators/plan-discovery-engine.cjs';
import planSchema from '../../schemas/project-plan.schema.json' with { type: 'json' };
import currentStateSchema from '../../schemas/current-project-state.schema.json' with { type: 'json' };

setGovernanceEngines({
  governance: governanceEngine,
  discovery: discoveryEngine,
  planSchema,
  currentStateSchema,
});

/**
 * The commands this worker may run.
 *
 * DELIBERATELY NARROWER THAN THE PARENT'S. Only the provider-backed command needs to leave the event
 * loop, and a worker that could run anything would be a second execution route for verbs that
 * already have one. Anything else is refused here as well as there.
 */
const COMMANDS = { plan: planCommand };

/**
 * The one shape this worker will run, checked here rather than assumed of its caller.
 *
 * WHY IT IS RE-ASKED. Today `host.mjs` is the only caller and it builds this payload itself from an
 * already-validated governed request, so nothing owner-controlled can reach `command` or
 * `positionals`. That is a property of the CALLER, not of this file — and `plan` alone spans draft,
 * decide and activate, which carry very different authority. A second caller, or a change upstream
 * that forwarded more of the request, would have no backstop at all. Stating the contract here makes
 * the isolation structural, the same reasoning `approvePlan` already applies to its own identifiers.
 */
const ALLOWED_SUBCOMMAND = 'draft';
const ALLOWED_FLAGS = ['objective', 'authored'];

function outsideContract(request) {
  if (request.command !== 'plan') return true;
  const positionals = request.positionals ?? [];
  if (positionals.length !== 1 || positionals[0] !== ALLOWED_SUBCOMMAND) return true;
  return Object.keys(request.flags ?? {}).some((k) => !ALLOWED_FLAGS.includes(k));
}

/** Emit one line and stop. The parent reads exactly this and nothing else from stdout. */
function finish(code, lines) {
  process.stdout.write(JSON.stringify({ kind: 'governed-worker-result', code, lines }) + '\n');
  process.exit(0);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  let request;
  try {
    request = JSON.parse(input);
  } catch {
    finish(2, ['REFUSED (WORKER_REQUEST): the governed worker was given no readable request.']);
    return;
  }

  const root = typeof request.root === 'string' ? request.root : '';
  const fn = COMMANDS[request.command];
  if (root === '' || fn === undefined || outsideContract(request)) {
    finish(2, ['REFUSED (WORKER_REQUEST): the governed worker was given no runnable command.']);
    return;
  }

  let result;
  try {
    // Same binding as the in-process path: the governed root is git's working directory, not merely
    // an argument, because the daemon's own cwd is not a repository.
    const ctx = { sys: gitBoundSystem(agentSystem, process.env, root), root };
    result = fn(ctx, request.flags ?? {}, request.positionals ?? []);
  } catch {
    // Redacted deliberately — a raw error can carry a path — but never silent.
    process.stderr.write('projectos governed worker: command failed [redacted]\n');
    finish(2, ['REFUSED (RUNTIME_ERROR): the governed command could not be executed.']);
    return;
  }
  finish(result.code, result.lines);
});
