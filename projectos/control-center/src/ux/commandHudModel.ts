/**
 * THE COMMAND-CENTRE HUD — a second PROJECTION of data that already exists, never a second source.
 *
 * The owner's reference shows a dense command centre: system status, active projects, an agent
 * network, a mission panel, a live feed, performance metrics and a console. Reproducing that look
 * honestly is the whole problem, because three of those panels have no data behind them in
 * ProjectOS and two of them would be a second copy of something that already has one owner.
 *
 * So this file derives EVERY value from a source that already exists, and where the reference shows
 * a number ProjectOS cannot know, it says so instead of inventing one:
 *
 *   System status      <- `buildHealthModel`, the same four groups Health renders
 *   Active projects    <- the project inventory; a percentage ONLY for the project actually
 *                         reporting, because that is the only one whose progress is known
 *   Capabilities       <- `safety.approvalGates` / `forbiddenActions` / `authority`. This REPLACES
 *                         the reference's "AI Agent Network": there is no live agent registry, and
 *                         "PLANNER AI · ACTIVE" would be a claim about a process nobody can see.
 *   Mission            <- descriptive product language plus the real plan and programme position
 *   Feed               <- `recordedItems`, the SAME function the Activity feed uses
 *   Telemetry          <- NOT INSTRUMENTED. The reference shows CPU 23% / MEMORY 41% / NETWORK 68%
 *                         / DISK 37%; ProjectOS measures none of them. Real AI spend is shown in
 *                         its place, because that IS metered, and the absence is stated rather than
 *                         filled with a gauge that would look identical whether it were true or not.
 *   Runtime            <- read-only runtime facts. NOT a second command console: the Control
 *                         Center's composer remains the only place an owner can tell ProjectOS to
 *                         do anything.
 *
 * Pure: same projection and inventory in, same HUD out. No clock, no I/O — the system time is read
 * in the component, because a clock is not a fact about the project.
 *
 * Created in PROJECTOS-JARVIS-VISUAL-RESTORATION1A.
 */
import type { GovernedProjectsInventory, GovernedState } from '../governed/types';
import { buildHealthModel, type HealthTone } from './healthModel';
import { recordedItems } from '../owner/workspaceModel';

export interface HudStat {
  readonly label: string;
  /** Null is rendered as its own honest word — never as 0, never as an empty cell. */
  readonly value: string | null;
  readonly tone: HealthTone;
}

export interface HudProject {
  readonly name: string;
  /** Only ever present for the project ProjectOS is actually reporting on. */
  readonly percent: number | null;
  /** What is known instead of a percentage, for every other project. */
  readonly note: string;
  readonly selected: boolean;
}

export interface HudFeedItem {
  readonly at: string;
  readonly text: string;
  readonly tone: HealthTone;
}

export interface CommandHud {
  readonly status: readonly HudStat[];
  readonly projects: readonly HudProject[];
  readonly projectsNote: string | null;
  readonly capabilities: readonly HudStat[];
  readonly mission: readonly string[];
  readonly missionContext: readonly HudStat[];
  readonly feed: readonly HudFeedItem[];
  readonly feedNote: string | null;
  readonly usage: readonly HudStat[];
  /** Said out loud rather than drawn as a gauge. */
  readonly telemetryNote: string;
  readonly runtime: readonly HudStat[];
}

const TIME = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(11, 19) : '--:--:--';
};

/** The one descriptive sentence about what ProjectOS is. Product copy, not an operational claim. */
const MISSION: readonly string[] = [
  'ProjectOS plans, builds, tests and delivers real projects — and stops to ask you before anything reaches customers, payments or the live site.',
];

export function buildCommandHud(
  governed: GovernedState | null,
  inventory: GovernedProjectsInventory | null,
): CommandHud {
  const live = governed !== null && governed.connected ? governed : null;
  const health = buildHealthModel(governed);

  // ── SYSTEM STATUS. The same four groups Health shows, in the same words and the same tones. ──
  const status: readonly HudStat[] = health.groups.map((g) => ({
    label: g.title,
    value: g.headline,
    tone: g.tone,
  }));

  // ── ACTIVE PROJECTS. A percentage is a claim about progress, and progress is only known for the
  //    project the runtime is reporting on. Every other row says what IS known: that it is
  //    registered and not currently being reported on. No bar is drawn from a guess. ──
  const projects: readonly HudProject[] =
    inventory === null
      ? []
      : inventory.projects.map((p) => {
          const isLive = live !== null && inventory.selectedProjectId === p.projectId && live.projectId === p.projectId;
          return {
            name: p.projectName,
            percent: isLive ? live.programme.completionPercentage : null,
            note: isLive ? `${live.programme.acceptedPhaseCount} of ${live.programme.totalPhaseCount} accepted` : 'not reporting',
            selected: isLive,
          };
        });
  const projectsNote =
    inventory === null ? 'ProjectOS has not reported which projects are on this computer.' : null;

  // ── CAPABILITIES. What ProjectOS will and will not do without asking — the real safety record,
  //    standing in for the reference's invented agent roster. ──
  const capabilities: readonly HudStat[] = live === null
    ? [{ label: 'Governed capabilities', value: 'Not reporting', tone: 'unknown' }]
    : [
        { label: 'Live site', value: live.safety.productionFreeze ? 'Frozen' : 'NOT frozen', tone: live.safety.productionFreeze ? 'ok' : 'problem' },
        { label: 'Always asks first', value: live.safety.approvalGates.length > 0 ? live.safety.approvalGates.join(' · ') : 'None recorded', tone: live.safety.approvalGates.length > 0 ? 'ok' : 'unknown' },
        { label: 'Never permitted', value: live.safety.forbiddenActions.length > 0 ? live.safety.forbiddenActions.join(' · ') : 'None recorded', tone: live.safety.forbiddenActions.length > 0 ? 'ok' : 'unknown' },
        { label: 'Closure authority', value: live.authority.closureAuthority || 'Not recorded', tone: 'ok' },
      ];

  // ── MISSION. One descriptive line, then the real position of the real plan. ──
  const missionContext: readonly HudStat[] = live === null
    ? [{ label: 'Current plan', value: 'No project is reporting', tone: 'unknown' }]
    : [
        { label: 'Project', value: live.projectName, tone: 'ok' },
        { label: 'Plan', value: `${live.plan.planVersion} · ${live.plan.declaredStatus}`, tone: live.plan.ready ? 'ok' : 'attention' },
        { label: 'Programme', value: `${live.programme.acceptedPhaseCount} of ${live.programme.totalPhaseCount} phases accepted`, tone: 'ok' },
        { label: 'Next safe action', value: live.nextSafeAction || 'Not recorded', tone: 'ok' },
      ];

  // ── FEED. The SAME `recordedItems` the Activity feed reads. One source, two projections. ──
  const feed: readonly HudFeedItem[] = live === null
    ? []
    : recordedItems(live).slice(0, 6).map((i) => ({
        at: TIME(i.at),
        // The phase DESCRIPTION and its recorded outcome, exactly as the Activity feed prints them.
        text: `${i.title} — ${i.outcome}`,
        tone: i.state === 'blocked' ? 'problem' : i.waiting ? 'attention' : 'ok',
      }));
  const feedNote = live === null ? 'Nothing has been recorded here yet.' : feed.length === 0 ? 'Nothing recorded for this project yet.' : null;

  // ── USAGE + TELEMETRY. Spend is metered and therefore real. Machine telemetry is not measured at
  //    all, and the panel says exactly that rather than showing a gauge. ──
  const usageGroup = health.groups.find((g) => g.id === 'usage');
  const usage: readonly HudStat[] = usageGroup === undefined
    ? []
    : usageGroup.facts.slice(0, 4).map((f) => ({ label: f.label, value: f.value, tone: usageGroup.tone }));

  const runtimeGroup = health.groups.find((g) => g.id === 'runtime');
  const runtime: readonly HudStat[] = [
    { label: 'Runtime', value: runtimeGroup?.headline ?? 'Not known', tone: runtimeGroup?.tone ?? 'unknown' },
    { label: 'Last reported', value: live === null ? null : (live.observedAt || null), tone: live === null ? 'unknown' : 'ok' },
    { label: 'Owner', value: live?.authority.owner ?? null, tone: 'ok' },
  ];

  return {
    status,
    projects,
    projectsNote,
    capabilities,
    mission: MISSION,
    missionContext,
    feed,
    feedNote,
    usage,
    telemetryNote: 'System telemetry — CPU, memory, disk and network — is NOT INSTRUMENTED. ProjectOS does not measure it, so nothing is shown for it.',
    runtime,
  };
}
