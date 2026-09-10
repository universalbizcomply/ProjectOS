/**
 * The disk side of hybrid gatekeeper routing: which mode a project is in, and where an interactive
 * question is written down and its answer read back.
 *
 * THE MODE IS READ FROM THE COMMITTED CONFIGURATION, for the reason `programmeId` is. Which mode a
 * project is in decides WHO answers its gatekeeper questions, so it may not be re-pointed by a working
 * copy edit nobody reviewed: a working copy that disagrees with the committed file is refused, never
 * silently preferred either way. That is also what makes "no silent switch" structural — the only way
 * from one mode to the other is a committed change the owner can see.
 *
 * A PROJECT WITH NO GATEKEEPER CONFIGURATION IS INTERACTIVE. That is not a new default: it is how every
 * such project has always run — the loop stops and the owner carries the question to ChatGPT. A project
 * that HAS configured a gatekeeper but not said which mode is refused, because choosing for it would
 * change how its decisions are obtained without anyone deciding that.
 *
 * Created in PROJECTOS-HYBRID-GATEKEEPER-ROUTING1A.
 */
import { join } from 'node:path';
import {
  DEFAULT_GATEKEEPER_MODE,
  GATEKEEPER_MODES,
  isGatekeeperMode,
  type GatekeeperDecisionRecord,
  type GatekeeperMode,
} from '@projectos/core';
import type { System } from '../system.js';
import { readCommittedJson } from '../planApproval.js';
import { GATEKEEPER_CONFIG_REL } from './gatekeeperConfig.js';
import type { InteractiveDecisionPort, InteractiveDecisionRead, InteractiveHandoff } from './interactiveGatekeeper.js';

/** Where interactive questions and answers live. One flat directory, filenames derived from request ids. */
export const GATEKEEPER_INTERACTIVE_REL = '.projectops/gatekeeper-interactive';

/** The only filenames the interactive port reads or writes. A request id is derived, never supplied. */
export const INTERACTIVE_RECORD_FILENAME = /^GKREQ-[0-9a-f]{24}\.(request|decision|consumed)\.json$/;
const REQUEST_ID = /^GKREQ-[0-9a-f]{24}$/;

/** A supplied decision larger than this is not a decision; the Host inbox uses the same bound. */
const MAX_DECISION_BYTES = 64 * 1024;

export type ModeResolution =
  | { readonly ok: true; readonly mode: GatekeeperMode; readonly source: 'default' | 'committed' }
  | { readonly ok: false; readonly reasons: readonly string[] };

function workingConfig(sys: System, root: string): 'absent' | 'invalid' | Record<string, unknown> {
  const text = sys.readText(join(root, ...GATEKEEPER_CONFIG_REL.split('/')));
  if (text === null) return 'absent';
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : 'invalid';
  } catch {
    return 'invalid';
  }
}

/**
 * This project's gatekeeper mode, or every reason it cannot be established.
 *
 * Callers must already know git answers (`run.ts` refuses first when it does not), because an
 * unanswerable committed read and an absent committed file are otherwise the same `null`.
 */
export function resolveGatekeeperMode(sys: System, root: string): ModeResolution {
  const working = workingConfig(sys, root);
  const committed = readCommittedJson(sys, root, GATEKEEPER_CONFIG_REL);
  if (working === 'absent' && committed === null) {
    return { ok: true, mode: DEFAULT_GATEKEEPER_MODE, source: 'default' };
  }
  if (committed === null) {
    return {
      ok: false,
      reasons: [
        `${GATEKEEPER_CONFIG_REL} exists but is not committed; the gatekeeper mode decides who answers this ` +
          "project's gatekeeper questions, so it applies only once it has passed the owner's commit gate",
      ],
    };
  }
  const mode = committed['mode'];
  if (mode === undefined) {
    return {
      ok: false,
      reasons: [
        `the committed ${GATEKEEPER_CONFIG_REL} configures a gatekeeper but declares no "mode"`,
        `  declare "mode": one of ${GATEKEEPER_MODES.map((m) => `"${m}"`).join(' or ')}, and commit it`,
        '  ProjectOS will not pick one for a configured project: picking would silently change how its decisions are obtained',
      ],
    };
  }
  if (!isGatekeeperMode(mode)) {
    return {
      ok: false,
      reasons: [`the committed ${GATEKEEPER_CONFIG_REL} declares mode ${JSON.stringify(mode)}, which is not one of: ${GATEKEEPER_MODES.join(', ')}`],
    };
  }
  const workingMode = typeof working === 'object' ? working['mode'] : undefined;
  if (workingMode !== mode) {
    return {
      ok: false,
      reasons: [
        `the working copy of ${GATEKEEPER_CONFIG_REL} does not declare the committed mode '${mode}'; commit the ` +
          'change or restore the file — a mode switch applies only once it is committed',
      ],
    };
  }
  return { ok: true, mode, source: 'committed' };
}

/** A synchronous pause. The loop is synchronous throughout; this only ever runs while waiting. */
function blockFor(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readDecision(sys: System, path: string): InteractiveDecisionRead {
  const text = sys.readText(path);
  if (text === null) {
    return sys.exists(path) ? { kind: 'unreadable', detail: 'the decision file exists but could not be read' } : { kind: 'absent' };
  }
  if (text.length > MAX_DECISION_BYTES) {
    return { kind: 'unreadable', detail: `the decision file is larger than ${MAX_DECISION_BYTES} bytes` };
  }
  try {
    // A leading byte-order mark is what an ordinary Windows editor writes; it is not part of the JSON.
    const parsed: unknown = JSON.parse(text.replace(/^﻿/, ''));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { kind: 'unreadable', detail: 'the decision file is not a JSON object' };
    }
    return { kind: 'present', record: parsed as GatekeeperDecisionRecord };
  } catch {
    return { kind: 'unreadable', detail: 'the decision file is not valid JSON' };
  }
}

/**
 * The interactive port over the governed checkout.
 *
 * THE GATE IS HELD OPEN WHILE THE GATEKEEPER ANSWERS. A decision is bound to the exact evidence it
 * answers, and a later run produces its own evidence — ProjectOS's run records are part of the reviewed
 * candidate — so it asks a NEW question, and an answer saved for the old one never applies to it. The
 * answer therefore has to arrive while the run that asked is still waiting: `waitMs` bounds that wait,
 * and zero looks once and ends the run at the question. `onWaiting` is told where the question is and
 * where the answer goes, once, as the wait begins — a waiting run returns nothing until it ends.
 */
export function nodeInteractivePort(
  sys: System,
  root: string,
  opts: {
    readonly waitMs?: number;
    readonly pollMs?: number;
    readonly sleep?: (ms: number) => void;
    readonly onWaiting?: (where: { readonly request: string; readonly decision: string }) => void;
  } = {},
): InteractiveDecisionPort {
  const dir = join(root, ...GATEKEEPER_INTERACTIVE_REL.split('/'));
  const pathOf = (requestId: string, kind: 'request' | 'decision' | 'consumed'): string | null =>
    REQUEST_ID.test(requestId) ? join(dir, `${requestId}.${kind}.json`) : null;
  const waitMs = Math.max(0, opts.waitMs ?? 0);
  const pollMs = Math.max(50, opts.pollMs ?? 5_000);
  const sleep = opts.sleep ?? blockFor;
  const locations = (requestId: string): { readonly request: string; readonly decision: string } => ({
    request: `${GATEKEEPER_INTERACTIVE_REL}/${requestId}.request.json`,
    decision: `${GATEKEEPER_INTERACTIVE_REL}/${requestId}.decision.json`,
  });

  return {
    locations,
    publishRequest(handoff: InteractiveHandoff) {
      const path = pathOf(handoff.requestId, 'request');
      const answer = pathOf(handoff.requestId, 'decision');
      if (path === null || answer === null) return 'refused: the request id cannot safely become a record name';
      const content = `${JSON.stringify(handoff, null, 2)}\n`;
      // AN ANSWER THAT PREDATES ITS QUESTION WAS NOT GIVEN IN ANSWER TO IT. The answer file is outside
      // the reviewed candidate, so anything that ran before the gate — the worker included — could
      // otherwise plant one under a predictable name. Refused, and left untouched for the owner to see.
      if (!sys.exists(path) && sys.exists(answer)) {
        return (
          'refused: a decision for this request already exists although the question was never asked, so it ' +
          'cannot have been given in answer to it; it was left untouched and nothing was applied'
        );
      }
      if (sys.createExclusive(path, content)) return 'written';
      const existing = sys.readText(path);
      if (existing === content) return 'already-published';
      return existing === null
        ? 'refused: the request could not be written or read back'
        : 'conflict: a different question is already recorded under this request id; it was left untouched';
    },
    awaitDecision(requestId) {
      const path = pathOf(requestId, 'decision');
      if (path === null) return { kind: 'unreadable', detail: 'the request id cannot safely become a record name' };
      const deadline = Date.now() + waitMs;
      let announced = false;
      for (;;) {
        const read = readDecision(sys, path);
        const left = deadline - Date.now();
        if (read.kind !== 'absent' || left <= 0) return read;
        if (!announced) {
          announced = true;
          opts.onWaiting?.(locations(requestId));
        }
        sleep(Math.min(pollMs, left));
      }
    },
    consumeDecision(requestId) {
      const path = pathOf(requestId, 'consumed');
      if (path === null) return 'refused: the request id cannot safely become a record name';
      if (sys.createExclusive(path, `${JSON.stringify({ requestId, consumedAt: sys.now() })}\n`)) return 'consumed';
      return sys.exists(path)
        ? 'this decision was already acted on and cannot be applied a second time'
        : 'the decision could not be marked as spent, so it was not applied';
    },
  };
}
