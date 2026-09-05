/**
 * DERIVE REPLAY FIXTURES FROM COMMITTED GATEKEEPER DECISIONS — redacting, then normalising.
 *
 * Replay exists so the gatekeeper CONTRACT can be tested for free, deterministically, without a
 * provider call. To be worth anything the fixtures must be shaped like the real thing; to be safe
 * to commit they must carry nothing the real thing carried that we do not need.
 *
 * WHAT IS REPLACED, AND WHY REPLACED RATHER THAN DROPPED. `reason` and `nextClaudeInstruction` are
 * the two fields a provider writes in prose. The first attempt dropped them — and the contract
 * refused every fixture, because it REQUIRES them: an unexplained verdict is not reviewable, and an
 * approval that says nothing about what happens next is not actionable. So they are not
 * "unnecessary provider response"; they are part of the contract, and a fixture without them would
 * prove the checker rejects a shape no real decision has.
 *
 * They are therefore replaced with fixed synthetic text. The field is present and non-empty, so the
 * checker's requirement is genuinely exercised; the provider's actual words are not committed. A
 * redactor that tried to scrub real prose would be a filter that has to be right every time against
 * text nobody controls — substitution cannot be wrong in that way.
 *
 * WHAT IS NORMALISED. Commit ids, request digests and decision ids are replaced with deterministic
 * synthetic values. They are not secret, but they tie a fixture to a moment in this repository's
 * history, and a fixture that drifts with history is one that starts failing for reasons unrelated
 * to the contract it tests.
 *
 * WHAT IS KEPT. Exactly the fields the contract reads, in the shapes it accepts. That is the whole
 * point: a fixture that dropped a field the checker consults would prove nothing about the checker.
 *
 * ONE-SHOT, AND ITS OUTPUT IS COMMITTED. This is run by hand when new decision shapes are worth
 * capturing; the tests read the committed fixtures and never run this. So replay stays free and
 * offline even on a machine with no `.projectops` history at all.
 *
 * Usage:  node projectos/agent/test/replay/deriveFixtures.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { checkGatekeeperDecision, ALWAYS_OWNER_ONLY } from '../../../core/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..');
const SOURCE = join(REPO, '.projectops', 'gatekeeper-decisions');
const OUT = join(HERE, 'fixtures');

/**
 * The fields the contract actually reads. Anything not named here is not carried, which makes the
 * redaction a closed allowlist rather than a list of things we remembered to remove.
 */
const CONTRACT_FIELDS = [
  'schemaVersion',
  'recordKind',
  'decisionId',
  'projectId',
  'phaseId',
  'subjectCommit',
  'requestDigest',
  'decision',
  'allowedActions',
  'forbiddenActions',
  'ownerApprovalRequired',
  'decidedBy',
  'decidedAt',
  'consumedAt',
  'reason',
  'nextClaudeInstruction',
];

/** Fixed stand-ins for the two prose fields the contract requires but whose content it never reads. */
const SYNTHETIC_REASON = 'Replay fixture: the provider prose is not carried, only its presence.';
const SYNTHETIC_NEXT = 'Replay fixture: no instruction is carried; this field exists to be required.';

/** A stable synthetic value for a real one: same input, same output, no history carried. */
function synth(prefix, real, width) {
  const h = createHash('sha256').update(prefix + ':' + String(real)).digest('hex');
  return h.slice(0, width);
}

function normalise(record, index) {
  const out = {};
  for (const key of CONTRACT_FIELDS) {
    if (!(key in record)) continue;
    out[key] = record[key];
  }
  // Deterministic stand-ins. The SHAPE each field must have is preserved exactly — 40 hex for a
  // commit, `sha256:` plus 64 hex for a digest — because the contract checks those shapes.
  if (typeof out.subjectCommit === 'string') out.subjectCommit = synth('commit', out.subjectCommit, 40);
  if (typeof out.requestDigest === 'string') out.requestDigest = 'sha256:' + synth('digest', out.requestDigest, 64);
  if (typeof out.decisionId === 'string') out.decisionId = 'GKDEC-REPLAY-' + String(index).padStart(2, '0');
  if (typeof out.decidedAt === 'string') out.decidedAt = '2026-01-01T00:00:00.000Z';
  if (typeof out.consumedAt === 'string') out.consumedAt = '2026-01-01T00:00:01.000Z';
  // The provider's own words never enter the repository; their REQUIREMENT is what is preserved.
  if (typeof out.reason === 'string') out.reason = SYNTHETIC_REASON;
  if (typeof out.nextClaudeInstruction === 'string') out.nextClaudeInstruction = SYNTHETIC_NEXT;
  return out;
}

const files = readdirSync(SOURCE).filter((f) => f.endsWith('.json')).sort();
mkdirSync(OUT, { recursive: true });

/**
 * CLASSIFIED BY THE CHECKER ITSELF, NOT BY ASSUMPTION.
 *
 * Every one of these was a real accepted decision at the time it was made. Three of them are
 * REFUSED by the contract as it stands today, because they carry no `nextClaudeInstruction` — a
 * requirement the checker gained after they were written. Filing them as "accepted" would have
 * produced a suite that fails for a reason that has nothing to do with the code under test; hiding
 * them would have thrown away the most interesting fixtures here.
 *
 * So each is run through the real checker and named for what it actually is. The refused ones are
 * kept deliberately: they are genuine historical evidence that the contract tightened, and they
 * prove the checker still refuses an under-specified decision.
 */
function classify(fixture) {
  const problems = checkGatekeeperDecision(fixture, {
    projectId: fixture.projectId,
    phaseId: fixture.phaseId,
    subjectCommit: fixture.subjectCommit,
    requestDigest: fixture.requestDigest,
    expectedDecider: 'ChatGPT',
    alreadyConsumedDecisionIds: [],
    // THE REAL FLOOR, IMPORTED — never a list retyped here.
    //
    // An earlier version hardcoded `['merge','force-push','deploy','phase-closure']`, which is not
    // the constitution's list: it omits `commit` and `push`, the two actions this project most
    // needs a decision to be incapable of granting. Every classification it made was therefore made
    // under a laxer rule than the runtime's, and a fixture granting `commit` was filed as an
    // acceptable shape. A replay suite that classifies under its own private rule is measuring
    // itself.
    ownerOnlyActions: ALWAYS_OWNER_ONLY,
  });
  return problems.length === 0 ? 'accepted' : 'refused';
}

const derived = [];
const seen = new Set();
let accepted = 0;
let refused = 0;
files.forEach((f, i) => {
  const raw = JSON.parse(readFileSync(join(SOURCE, f), 'utf8'));
  const fixture = normalise(raw, i);
  // One fixture per distinct CONTRACT SHAPE, not one per historical record. Twelve copies of the
  // same shape would make the suite slower and prove nothing extra.
  //
  // The key must name EVERY field the checker's outcome can turn on, or two records the contract
  // treats differently collapse into one and the difference is never captured.
  //
  // CORRESPONDENCE WITH checkGatekeeperDecision (gatekeeperDecision.ts):
  //   Keyed here           Checker branch
  //   ─────────────────    ──────────────────────────────────────────────
  //   decision             verdict vocabulary, continuation, owner-gated
  //   allowedActions       owner-only grant check, array validity
  //   forbiddenActions     array presence check
  //   ownerApprovalRequired boolean type + owner-gated consistency
  //   decidedBy            decider identity + implementer guard
  //   nextClaudeInstruction continuation instruction presence
  //   consumedAt           consumption marker replay guard
  //
  // NOT KEYED (uniform across all source records after normalisation):
  //   schemaVersion        always "1.0.0" — the only accepted value
  //   decisionId           normalised to GKDEC-REPLAY-NN — always valid
  //   decidedAt            normalised to a fixed timestamp — always present
  //   reason               normalised to synthetic text — always present
  //   projectId/phaseId/subjectCommit/requestDigest — binding checks only,
  //     normalised to synthetic values, tested via mutation in the suite
  //
  // IF THE CHECKER GAINS A NEW DISCRIMINATING FIELD, add it here or two
  // records it now treats differently will collapse into one fixture.
  const shape = JSON.stringify([
    fixture.decision,
    fixture.allowedActions,
    Array.isArray(fixture.forbiddenActions),
    fixture.ownerApprovalRequired,
    fixture.decidedBy,
    'nextClaudeInstruction' in fixture,
    'consumedAt' in fixture,
  ]);
  if (seen.has(shape)) return;
  seen.add(shape);
  const kind = classify(fixture);
  const n = kind === 'accepted' ? (accepted += 1) : (refused += 1);
  derived.push({ name: `${kind}-${String(n).padStart(2, '0')}.json`, fixture });
});

for (const d of derived) {
  writeFileSync(join(OUT, d.name), JSON.stringify(d.fixture, null, 2) + '\n');
}

console.log(`read ${files.length} committed decision(s)`);
console.log(`wrote ${accepted} accepted and ${refused} refused shape(s) to ${OUT}`);
console.log('classification comes from the real checker, not from an assumption');
console.log('replaced with synthetic text: reason, nextClaudeInstruction (required by the contract, content never read)');
console.log('normalised: subjectCommit, requestDigest, decisionId, decidedAt, consumedAt');
