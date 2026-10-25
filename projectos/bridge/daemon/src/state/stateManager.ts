/**
 * State reducer — pure. Folds one event into the derived PhaseState. This is the daemon's
 * core: every state.json on disk is reproducible by replaying the event log through here
 * (see recoveryManager), which is what makes restart lossless.
 */
import { DAEMON_VERSION } from '../constants.js';
import type {
  BridgeEvent,
  PhaseStage,
  PhaseState,
  PhaseStatus,
  ValidatorState,
} from '../types.js';
import { isAllowedTransition, stageForEvent, stageToStatus } from './stateMachine.js';

export interface ApplyResult {
  readonly state: PhaseState;
  /** Set when the event implied a transition the machine refused (an anomaly to log). */
  readonly refusedTransition: { readonly from: PhaseStage; readonly to: PhaseStage } | null;
}

/** A fresh phase state for a project/phase not seen before. */
export function initialState(
  project: string,
  phase: string,
  at: string,
  source: string,
): PhaseState {
  return {
    project,
    phase,
    stage: 'created',
    status: 'draft',
    updatedAt: at,
    worker: '',
    source,
    version: DAEMON_VERSION,
    lastSeq: -1,
    validators: 'unknown',
    decisionRequired: false,
  };
}

function nextValidators(current: ValidatorState, event: BridgeEvent): ValidatorState {
  switch (event.type) {
    case 'VALIDATION_STARTED':
      return 'running';
    case 'VALIDATION_COMPLETED': {
      const result = event.payload?.['result'];
      return result === 'fail' ? 'fail' : 'pass';
    }
    case 'FILES_CHANGED':
      return 'unknown';
    default:
      return current;
  }
}

function changedFilesFor(event: BridgeEvent): readonly string[] | undefined {
  if (event.type !== 'FILES_CHANGED') return undefined;
  if (event.relatedFiles && event.relatedFiles.length > 0) return event.relatedFiles;
  const files = event.payload?.['files'];
  if (Array.isArray(files)) return files.filter((f): f is string => typeof f === 'string');
  return undefined;
}

/** Fold an event into the state, returning a new state (never mutates the input). */
export function applyEvent(state: PhaseState, event: BridgeEvent): ApplyResult {
  const from = state.stage;
  let refused: ApplyResult['refusedTransition'] = null;

  // Resolve the target stage. PHASE_RESUMED is special: it returns to the pre-block stage.
  let target: PhaseStage | null;
  if (event.type === 'PHASE_RESUMED') {
    target = from === 'blocked' ? (state.resumeStage ?? 'implementing') : null;
  } else {
    target = stageForEvent(event.type);
  }

  let stage = from;
  let resumeStage = state.resumeStage;

  if (target !== null && target !== from) {
    const legal =
      event.type === 'PHASE_RESUMED' ? from === 'blocked' : isAllowedTransition(from, target);
    if (legal) {
      // Entering blocked: remember where to resume (unless already blocked).
      if (target === 'blocked' && from !== 'blocked') resumeStage = from;
      if (event.type === 'PHASE_RESUMED') resumeStage = undefined;
      stage = target;
    } else {
      refused = { from, to: target };
    }
  }

  // Status: closing out of a blocked/rolled-back stage records closed_as_blocked.
  let status: PhaseStatus = stageToStatus(stage);
  if (stage === 'closed' && (from === 'blocked' || from === 'rolled_back')) {
    status = 'closed_as_blocked';
  }

  const validators = nextValidators(state.validators, event);
  const changed = changedFilesFor(event);
  const lastSeq = event.seq >= 0 ? event.seq : state.lastSeq;

  const next: PhaseState = {
    project: state.project,
    phase: state.phase,
    stage,
    status,
    updatedAt: event.at,
    worker: event.worker ?? state.worker,
    source: event.source || state.source,
    version: DAEMON_VERSION,
    lastSeq,
    validators,
    decisionRequired: event.decisionRequired,
    ...(state.branch !== undefined ? { branch: state.branch } : {}),
    ...(state.head !== undefined ? { head: state.head } : {}),
    ...(changed !== undefined
      ? { changedFiles: changed }
      : state.changedFiles !== undefined
        ? { changedFiles: state.changedFiles }
        : {}),
    ...(state.blockers !== undefined ? { blockers: state.blockers } : {}),
    ...(resumeStage !== undefined ? { resumeStage } : {}),
  };
  return { state: next, refusedTransition: refused };
}

/** Apply an observed git commit: advances ready_to_commit → committed. Pure. */
export function applyGitCommit(state: PhaseState, head: string, at: string): PhaseState {
  const base: PhaseState = { ...state, head, updatedAt: at };
  if (state.stage !== 'ready_to_commit') return base;
  return { ...base, stage: 'committed', status: stageToStatus('committed') };
}

/** Apply an observed push: advances committed/ready_to_push → pushed. Pure. */
export function applyGitPush(state: PhaseState, at: string): PhaseState {
  if (state.stage !== 'committed' && state.stage !== 'ready_to_push') {
    return { ...state, updatedAt: at };
  }
  return { ...state, stage: 'pushed', status: stageToStatus('pushed'), updatedAt: at };
}
