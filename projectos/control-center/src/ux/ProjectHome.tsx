/**
 * SCREEN 2 — ONE PROJECT, and the five tabs the accepted architecture gives it.
 *
 * OVERVIEW ANSWERS SEVEN QUESTIONS AND ASKS FOR NOTHING TECHNICAL. What project am I in, what is
 * happening, what is the active plan, which step, is anything blocked, do I need to decide, what
 * happened most recently. Repository, branch, head, plan paths, digests, session identifiers and
 * runtime internals are not on it — they are under Advanced, where they are evidence rather than
 * noise.
 *
 * IT DERIVES; IT DOES NOT DECIDE. The headline, the single primary action and the owner's inbox all
 * come from the existing models — `buildHomeModel`, `buildContinueWorking`, `buildPlansModel` — so
 * this screen cannot disagree with the Plans tab or the Projects list about the same project.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { useMemo } from 'react';
import type { GovernedProjection } from '../governed/types';
import { buildHomeModel } from '../owner/homeModel';
import { buildContinueWorking } from '../owner/continueWorkingModel';
import { OwnerActionInbox } from '../owner/OwnerActionInbox';
import { recordedItems, relativeTime, statusInk, dotColour, stateFromStatus } from '../owner/workspaceModel';
import { PlansScreen } from './PlansScreen';

export type ProjectTab = 'overview' | 'plans' | 'activity' | 'files' | 'advanced';

const TABS: ReadonlyArray<{ id: ProjectTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'plans', label: 'Plans' },
  { id: 'activity', label: 'Activity' },
  { id: 'files', label: 'Files' },
  { id: 'advanced', label: 'Advanced' },
];

/** The activity feed. One component, one data source; the Control Center renders the same rows. */
export function ActivityFeed({
  state,
  now,
  limit,
}: {
  state: GovernedProjection;
  now: number;
  limit?: number;
}) {
  const items = useMemo(() => recordedItems(state), [state]);
  const shown = limit === undefined ? items : items.slice(0, limit);

  if (shown.length === 0) {
    return <p className="os-empty">Nothing has been recorded for this project yet.</p>;
  }

  return (
    <ul className="ux-feed">
      {shown.map((item) => (
        <li className="ux-feedrow" key={item.id}>
          <span className="ux-feeddot" style={{ background: dotColour(item.state) }} aria-hidden="true" />
          <span className="ux-feedbody">
            <span className="ux-feedtitle">{item.title}</span>
            <span className="ux-feedoutcome">{item.outcome}</span>
          </span>
          <span className="ux-feedwhen">{relativeTime(item.at, now)}</span>
        </li>
      ))}
    </ul>
  );
}

function Overview({
  state,
  now,
  onOpenPlans,
  onSeeAll,
  onPrimary,
}: {
  state: GovernedProjection;
  now: number;
  onOpenPlans: () => void;
  onSeeAll: () => void;
  onPrimary: () => void;
}) {
  const home = useMemo(() => buildHomeModel(state), [state]);
  const next = useMemo(() => buildContinueWorking(state, home.ownerActions, now), [state, home, now]);
  const complete =
    state.programme.totalPhaseCount > 0 &&
    state.programme.acceptedPhaseCount === state.programme.totalPhaseCount;
  const visual = stateFromStatus(next.status, false, complete);

  return (
    <div className="os-stack">
      {/* The status word, always beside its dot — never colour alone. */}
      <p className="ux-statusline">
        <span className="ux-feeddot" style={{ background: dotColour(visual) }} aria-hidden="true" />
        <span style={{ color: statusInk(visual) }}>{next.status}</span>
      </p>

      {/*
        EVERY blocking item, not just approvals. `buildHomeModel` counts three kinds — a pending
        approval, a plan that does not recompute ready, and a stopped budget — and only the first
        has an approval record. Rendering approvals alone once left the header saying "Waiting for
        you" over a screen with nothing on it to answer.
      */}
      {home.ownerActionRequired && (
        <section className="os-plate" aria-labelledby="ux-needs-title">
          <h2 className="os-h2" id="ux-needs-title">ProjectOS needs you</h2>
          {home.ownerActions.map((a) => (
            <div className="ux-need" key={a.id}>
              <p className="ux-needtitle">{a.title}</p>
              <p className="os-set-sub">{a.detail}</p>
            </div>
          ))}
          {state.pendingApprovals.length > 0 && <OwnerActionInbox state={state} />}
        </section>
      )}

      <section className="os-plate">
        <h2 className="os-h2">{next.primary.heading}</h2>
        <p className="os-set-sub">{next.primary.detail}</p>
        <div className="ux-planactions">
          <button type="button" className="os-pri" onClick={onPrimary}>
            {next.primary.label}
          </button>
          <button type="button" className="os-sec" onClick={onOpenPlans}>
            Open the plan
          </button>
        </div>
      </section>

      {home.blockers.length > 0 && (
        <section className="os-plate" aria-labelledby="ux-blocked-title">
          <h2 className="os-h2" id="ux-blocked-title">What is in the way</h2>
          <ul className="ux-planreasons">
            {home.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="ux-recent-title">
        <div className="ux-screenhead">
          <h2 className="os-h2" id="ux-recent-title">Recently</h2>
          <button type="button" className="os-ghost" onClick={onSeeAll}>See all</button>
        </div>
        <ActivityFeed state={state} now={now} limit={3} />
      </section>
    </div>
  );
}

/**
 * The technical record, under Advanced and nowhere else.
 *
 * Everything the normal journey must never require: the repository identity, the branch and head,
 * where the plan record lives, and what the runtime last observed. It is evidence, so it is plain.
 */
export function TechnicalDetail({ state }: { state: GovernedProjection }) {
  return (
    <div className="os-tech">
      <h3>Technical detail</h3>
      <div className="os-techgrid">
        <span className="k">Project</span><span className="v">{state.projectId}</span>
        <span className="k">Repository</span><span className="v">{state.repository.repo}</span>
        <span className="k">Folder</span><span className="v">{state.repository.localPath}</span>
        <span className="k">Branch</span><span className="v">{state.repository.branch ?? 'not known'}</span>
        <span className="k">Commit</span><span className="v">{state.repository.head ?? 'not known'}</span>
        <span className="k">Plan record</span><span className="v">{state.plan.planPath}</span>
        <span className="k">Plan ready</span>
        <span className="v">
          {state.plan.ready ? 'yes (recomputed)' : `no — ${state.plan.unmetReasons.join('; ')}`}
        </span>
        <span className="k">Owner</span><span className="v">{state.authority.owner}</span>
        <span className="k">Closure authority</span><span className="v">{state.authority.closureAuthority}</span>
        <span className="k">Last observed</span><span className="v">{state.observedAt}</span>
      </div>
    </div>
  );
}

export function ProjectHome({
  state,
  tab,
  setTab,
  now,
  onPrimary,
  onOpenAdvanced,
  onOpenPlanDetail,
}: {
  state: GovernedProjection;
  tab: ProjectTab;
  setTab: (t: ProjectTab) => void;
  now: number;
  onPrimary: () => void;
  onOpenAdvanced: (which: string) => void;
  /** Opening a plan shows its steps, its evidence and its governed controls. */
  onOpenPlanDetail: () => void;
}) {
  return (
    <div className="os-stack">
      <header className="ux-screenhead">
        <h1 className="os-h1">{state.projectName}</h1>
      </header>

      <div className="os-tabs os-glass" role="tablist" aria-label="Project">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="os-tab"
            aria-selected={tab === t.id}
            data-active={tab === t.id ? '1' : '0'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <Overview
          state={state}
          now={now}
          onOpenPlans={() => setTab('plans')}
          onSeeAll={() => setTab('activity')}
          onPrimary={onPrimary}
        />
      )}

      {tab === 'plans' && <PlansScreen state={state} onOpenPlan={() => onOpenPlanDetail()} />}

      {tab === 'activity' && (
        <section aria-label="Activity">
          <ActivityFeed state={state} now={now} />
        </section>
      )}

      {tab === 'files' && (
        <div className="os-plate">
          <h2 className="os-h2">Files</h2>
          {/*
            TRUTHFUL, NOT DECORATIVE. There is no governed verb that accepts a file: nothing in
            `GOVERNED_VERBS` carries one, and the renderer will not pretend otherwise. The place is
            drawn because the architecture names it; the capability is stated as absent.
          */}
          <p className="os-set-sub">
            ProjectOS cannot take files from you yet. When it can, documents you attach here will be
            available to the plans in this project.
          </p>
        </div>
      )}

      {tab === 'advanced' && (
        <div className="os-stack">
          <TechnicalDetail state={state} />
          <div className="os-plate">
            <h2 className="os-h2">Other surfaces</h2>
            <p className="os-set-sub">
              These are unchanged and are kept for when you need them.
            </p>
            <span className="os-advlinks">
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('live')}>Mission Control</button>
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('workflow')}>Workflow</button>
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('plugins')}>Integrations</button>
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('forge')}>Forge</button>
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('control')}>Owner Control</button>
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('chat')}>Owner Chat</button>
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('safety')}>Safety &amp; Providers</button>
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('gates')}>Safety Gates</button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
