/**
 * Add Project — README §Screens 4, restyled in place.
 *
 * THE HOST CALLS ARE UNTOUCHED, AND THEIR ORDER IS UNTOUCHED: `pick_folder`, `inspect_folder`,
 * `prepare_folder`, `register_project`, then `set_credential` per value — credentials only ever
 * after the project exists, because a credential reference names a project and storing one for a
 * project that was never added leaves a key with nothing to belong to.
 *
 * THIS COMPONENT STILL HAS NO AUTHORITY. Registration remains the bounded elevated helper behind a
 * real Windows prompt. This file names no helper, builds no command line and carries no confirmation
 * phrase, and an invariant test fails the build if a renderer source mentions any of them.
 *
 * WHAT CHANGED IS PRESENTATION. The six internal steps are kept and are shown as the four
 * owner-facing chips the design specifies — `type` and `name` share the Project step, and `check` is
 * folded into Folder as the inspection panel. **Continue stays disabled until the folder is
 * prepared**, exactly as before.
 *
 * ONE DEPARTURE FROM THE PROTOTYPE'S DATA, FOR A REASON THE PROTOTYPE ITSELF STATES. Its added-key
 * row shows the last four characters of the secret just typed, directly under approved copy reading
 * "handed straight to Windows and never shown again — not here, not in a report". Those cannot both
 * be true. The row keeps its masked mono treatment and reveals no characters.
 */
import { useState } from 'react';
import { tauriBridge } from '../daemon/tauriBridge';
import {
  CONNECTION_CATALOGUE,
  credentialReference,
  newProjectPath,
  projectIdFrom,
  valuesToStore,
  type PendingValue,
} from './addProjectModel';
import { IconBack, IconClose, IconFolder, IconInfo, IconTick } from './icons';

type Step = 'type' | 'name' | 'folder' | 'check' | 'connections' | 'review' | 'done';
type Kind = 'existing' | 'new';

interface Inspection {
  readonly readiness: string;
  readonly summary: string;
  readonly nextStep: string;
  readonly findings: readonly string[];
  readonly gitMarker: string;
  readonly hasProjectops: boolean;
  readonly declaredProjectId: string | null;
  readonly branch: string | null;
  readonly remote: string | null;
  readonly dirtyCount: number | null;
  readonly registeredAs: string | null;
}

/** Tauri returns snake_case fields; this is the one place that knows it. */
function toInspection(raw: Record<string, unknown>): Inspection {
  return {
    readiness: String(raw['readiness'] ?? 'NOT_A_FOLDER'),
    summary: String(raw['summary'] ?? ''),
    nextStep: String(raw['next_step'] ?? ''),
    findings: Array.isArray(raw['findings']) ? (raw['findings'] as string[]) : [],
    gitMarker: String(raw['git_marker'] ?? 'none'),
    hasProjectops: raw['has_projectops'] === true,
    declaredProjectId: (raw['declared_project_id'] as string | null) ?? null,
    branch: (raw['branch'] as string | null) ?? null,
    remote: (raw['remote'] as string | null) ?? null,
    dirtyCount: (raw['dirty_count'] as number | null) ?? null,
    registeredAs: (raw['registered_as'] as string | null) ?? null,
  };
}

/** Which of the four owner-facing chips an internal step belongs to. */
function chipOf(step: Step): number {
  if (step === 'type' || step === 'name') return 1;
  if (step === 'folder' || step === 'check') return 2;
  if (step === 'connections') return 3;
  return 4;
}

const CHIPS = ['Project', 'Folder', 'Connections', 'Review'] as const;

export function AddProjectWizard({
  onAdded,
  onCancel,
}: {
  onAdded?: (projectId: string) => void;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState<Step>('type');
  const [kind, setKind] = useState<Kind>('existing');
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [parent, setParent] = useState('');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [values, setValues] = useState<readonly PendingValue[]>([]);
  const [added, setAdded] = useState<readonly string[]>([]);
  const [service, setService] = useState<string>(CONNECTION_CATALOGUE[0]?.id ?? 'openai');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<readonly string[]>([]);

  const available = tauriBridge.isTauri();
  const projectId = projectIdFrom(name);
  const target = kind === 'new' ? newProjectPath(parent, name) : folder;
  const willCreate = kind === 'new' && inspection !== null && inspection.readiness === 'NOT_A_FOLDER';
  const isReady = inspection !== null && inspection.readiness === 'READY';
  const chip = chipOf(step);

  async function browse(): Promise<void> {
    setProblem(null);
    const forParent = kind === 'new';
    const title = forParent ? 'Choose where to create the project' : 'Choose the project folder';
    const picked = (await tauriBridge.invoke('pick_folder', { title })) as string | null;
    if (picked === null || picked === undefined) return; // cancelled — an ordinary outcome
    if (forParent) setParent(picked);
    else setFolder(picked);
    setPrepared([]);
    await look(forParent ? newProjectPath(picked, name) : picked);
  }

  async function look(path: string): Promise<void> {
    if (path === '') return;
    setBusy('Checking the folder…');
    setProblem(null);
    try {
      const raw = (await tauriBridge.invoke('inspect_folder', { path })) as Record<string, unknown>;
      setInspection(toInspection(raw));
      setStep('check');
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function prepare(): Promise<void> {
    setBusy('Setting it up…');
    setProblem(null);
    try {
      const raw = (await tauriBridge.invoke('prepare_folder', {
        path: target,
        projectId,
        projectName: name.trim(),
        createFolder: kind === 'new',
      })) as Record<string, unknown>;
      if (raw['ok'] !== true) {
        setProblem(String(raw['refusal'] ?? 'ProjectOS could not prepare that folder.'));
        return;
      }
      setPrepared(Array.isArray(raw['actions']) ? (raw['actions'] as string[]) : []);
      const again = (await tauriBridge.invoke('inspect_folder', { path: target })) as Record<string, unknown>;
      setInspection(toInspection(again));
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(null);
    }
  }

  function setValue(provider: string, key: string, label: string, valueKind: PendingValue['kind'], v: string) {
    setValues((prev) => {
      const rest = prev.filter((p) => !(p.provider === provider && p.key === key));
      return [...rest, { provider, key, label, kind: valueKind, value: v }];
    });
  }

  function valueOf(provider: string, key: string): string {
    return values.find((p) => p.provider === provider && p.key === key)?.value ?? '';
  }

  async function addProject(): Promise<void> {
    setBusy('Waiting for you to confirm, then for Windows permission…');
    setProblem(null);
    try {
      await tauriBridge.invoke('register_project', {
        projectId,
        repositoryRoot: target,
        environments: ['development'],
        productionFrozen: true,
      });
      for (const v of valuesToStore(values)) {
        await tauriBridge.invoke('set_credential', {
          reference: credentialReference(projectId, 'development', v.provider, v.key),
          value: v.value,
          replace: true,
        });
      }
      // Nothing entered is kept in memory once it has been handed over.
      setValues([]);
      setStep('done');
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!available) {
    return (
      <div className="os-stack">
        <div>
          <h1 className="os-h1">Add a project</h1>
          <p className="os-lede">
            Adding a project needs the ProjectOS desktop app. This is a browser preview.
          </p>
        </div>
      </div>
    );
  }

  const kindLabel = kind === 'new' ? 'Something new' : 'Something I already have';
  const nextLabel = chip === 3 ? 'Review' : chip === 4 ? 'Add project' : 'Continue';
  const nextBlocked =
    (chip === 1 && projectId === '') || (chip === 2 && (target === '' || !isReady)) || busy !== null;

  /** Each step starts at its own top, like every other screen change in the shell. */
  function toStep(next: Step) {
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  function goNext() {
    if (chip === 1) { toStep('folder'); return; }
    if (chip === 2) { toStep('connections'); return; }
    if (chip === 3) { toStep('review'); return; }
    void addProject();
  }

  function goBack() {
    if (chip === 1) { onCancel?.(); return; }
    if (chip === 2) { toStep('name'); return; }
    if (chip === 3) { toStep(inspection === null ? 'folder' : 'check'); return; }
    toStep('connections');
  }

  const catalogue = CONNECTION_CATALOGUE.find((c) => c.id === service) ?? CONNECTION_CATALOGUE[0];

  return (
    <div className="os-stack">
      <div>
        <button type="button" className="os-ghost" onClick={onCancel} style={{ marginBottom: 18, fontSize: '13.5px' }}>
          <IconBack />
          Cancel
        </button>
        <h1 className="os-h1">Add a project</h1>
        <p className="os-lede">
          {kind === 'new'
            ? 'Four short steps. ProjectOS creates the folder and sets itself up inside it.'
            : 'Four short steps. Point it at work you already have and it takes care of the rest.'}
        </p>
      </div>

      <ol className="os-wizsteps">
        {CHIPS.map((label, i) => {
          const n = i + 1;
          const on = chip === n;
          const past = chip > n;
          return (
            <li className="os-wizstep" key={label} data-on={on ? '1' : '0'} aria-current={on ? 'step' : undefined}>
              <span
                className="os-wizstep-n"
                style={{
                  background: on ? 'var(--acc)' : past ? 'var(--ok-soft)' : 'var(--idle-soft)',
                  color: on ? 'var(--acc-ink)' : past ? 'var(--ok)' : 'var(--faint)',
                }}
              >
                {n}
              </span>
              <span className="os-wizstep-l" style={{ color: on || past ? 'var(--ink)' : 'var(--faint)' }}>{label}</span>
            </li>
          );
        })}
      </ol>

      <section className="os-plate os-glass os-hud">
        <div className="os-hudlabel">
          <span>add project // step {chip} of 4</span>
          <span className="rule" />
          <span>{CHIPS[chip - 1]?.toLowerCase()}</span>
        </div>

        {chip === 1 && (
          <div>
            <h2 className="os-wizh2">What are we working on?</h2>
            <p className="os-wizsub">Give it a name you will recognise later. You can rename it any time.</p>
            <div className="os-choices" role="radiogroup" aria-label="What are you adding?">
              <button
                type="button"
                role="radio"
                aria-checked={kind === 'existing'}
                className="os-choice"
                data-on={kind === 'existing' ? '1' : '0'}
                onClick={() => { setKind('existing'); setStep('name'); }}
              >
                <b>Something I already have</b>
                <span>A folder of work already on this computer</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={kind === 'new'}
                className="os-choice"
                data-on={kind === 'new' ? '1' : '0'}
                onClick={() => { setKind('new'); setStep('name'); }}
              >
                <b>Something new</b>
                <span>Start from an empty folder</span>
              </button>
            </div>
            <label style={{ display: 'block', maxWidth: 420 }}>
              <span className="os-fieldlabel">Project name</span>
              <input
                className="os-input"
                value={name}
                placeholder="Booking app"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>
        )}

        {chip === 2 && (
          <div>
            <h2 className="os-wizh2">Where does it live?</h2>
            <p className="os-wizsub">
              {kind === 'new'
                ? 'Choose where the new folder should be created. ProjectOS makes it for you.'
                : 'Point ProjectOS at the folder your work is already in.'}
            </p>
            <div className="os-browserow">
              <button type="button" className="os-pri" disabled={busy !== null} onClick={() => void browse()}>
                <IconFolder />
                {kind === 'new' ? 'Choose where to create it' : 'Choose the folder'}
              </button>
              <span className="os-browsenote">Opens the normal Windows folder window.</span>
            </div>

            {target !== '' && (
              <div className="os-panelrow">
                <IconTick size={18} width={1.7} />
                <div style={{ minWidth: 0 }}>
                  <div className="k">Chosen folder</div>
                  <div className="v">{target}</div>
                </div>
                <button type="button" className="os-ghost" style={{ marginLeft: 'auto' }} onClick={() => void browse()}>
                  Change
                </button>
              </div>
            )}

            {inspection !== null && (
              <div className="os-inspect">
                <div className="os-inspect-head">
                  <span className="os-dot" style={{ background: isReady ? 'var(--ok)' : 'var(--warn)' }} aria-hidden="true" />
                  <span className="os-inspect-title">
                    {willCreate
                      ? 'Nothing here yet'
                      : isReady
                        ? 'This folder is ready'
                        : 'Folder found — not set up yet'}
                  </span>
                </div>
                {/* The host's own summary and next step, verbatim. */}
                <p>{willCreate ? 'This folder does not exist yet, so ProjectOS will create it.' : inspection.summary}</p>
                <div className="os-checks">
                  {(willCreate
                    ? ['The folder will be created', 'Project tracking will be started', 'ProjectOS setup will be added']
                    : isReady
                      ? prepared.length > 0
                        ? prepared
                        : inspection.findings
                      : ['Your existing files stay exactly as they are', ...inspection.findings]
                  ).map((text) => (
                    <div className="os-check" key={text}>
                      {isReady ? <IconTick size={14} width={1.8} /> : <IconInfo />}
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
                {!isReady && (
                  <button type="button" className="os-sec" disabled={busy !== null} onClick={() => void prepare()}>
                    {busy !== null ? 'Setting it up…' : kind === 'new' ? 'Create and set up' : 'Set it up'}
                  </button>
                )}
              </div>
            )}
            <p className="os-wiznote">
              ProjectOS only needs the folder. Git, config files and manifests are its business, not
              yours.
            </p>
          </div>
        )}

        {chip === 3 && (
          <div>
            <h2 className="os-wizh2">Connections and keys</h2>
            <p className="os-wizsub">
              Only add what this project uses. You can add more later, and nothing is used without
              your say-so.
            </p>
            <div className="os-keyrows">
              {added.map((id) => {
                const c = CONNECTION_CATALOGUE.find((x) => x.id === id);
                const mine = values.filter((v) => v.provider === id && v.value.trim() !== '');
                const hasSecret = mine.some((v) => v.kind === 'secret');
                return (
                  <div className="os-keyrow" key={id}>
                    <span className="svc">{c?.label ?? id}</span>
                    <span className="masked">
                      {hasSecret ? '••••••••••••' : mine.map((v) => v.label).join(', ') || 'nothing entered'}
                    </span>
                    <button
                      type="button"
                      className="os-ghost"
                      aria-label={`Remove ${c?.label ?? id}`}
                      onClick={() => {
                        setAdded((prev) => prev.filter((x) => x !== id));
                        setValues((prev) => prev.filter((v) => v.provider !== id));
                      }}
                    >
                      <IconClose />
                    </button>
                  </div>
                );
              })}
              {added.length === 0 && (
                <div style={{ padding: '16px 0', fontSize: '14.5px', color: 'var(--faint)' }}>
                  Nothing added yet — that is fine.
                </div>
              )}
            </div>

            <div className="os-servicebox">
              <label>
                <span className="os-fieldlabel">Service</span>
                <select className="os-select" value={service} onChange={(e) => setService(e.target.value)}>
                  {CONNECTION_CATALOGUE.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="os-fields">
              {(catalogue?.fields ?? []).map((f) => (
                <label className="os-field" key={f.key}>
                  <span className="os-field-head">
                    <span className="os-field-label">{f.label}</span>
                    <span className={`os-tag ${f.kind === 'secret' ? 'secret' : 'config'}`}>
                      {f.kind === 'secret' ? 'secret' : 'safe to share'}
                    </span>
                  </span>
                  <input
                    className="os-input"
                    type={f.kind === 'secret' ? 'password' : 'text'}
                    value={valueOf(catalogue?.id ?? '', f.key)}
                    autoComplete="off"
                    placeholder={f.kind === 'secret' ? 'Paste it here' : 'Paste or type it'}
                    onChange={(e) => setValue(catalogue?.id ?? '', f.key, f.label, f.kind, e.target.value)}
                  />
                  {f.hint !== undefined && <span className="os-hint">{f.hint}</span>}
                </label>
              ))}
              {(catalogue?.fields.length ?? 0) === 0 && (
                <label className="os-field">
                  <span className="os-field-head">
                    <span className="os-field-label">Value</span>
                    <span className="os-tag secret">secret</span>
                  </span>
                  <input
                    className="os-input"
                    type="password"
                    value={valueOf(catalogue?.id ?? '', 'value')}
                    autoComplete="off"
                    placeholder="Paste it here"
                    onChange={(e) => setValue(catalogue?.id ?? '', 'value', 'Value', 'secret', e.target.value)}
                  />
                </label>
              )}
            </div>

            <button
              type="button"
              className="os-sec"
              style={{ marginTop: 20, height: 46, padding: '0 20px', fontSize: '14.5px' }}
              onClick={() => {
                const id = catalogue?.id ?? '';
                if (id === '') return;
                if (valuesToStore(values).filter((v) => v.provider === id).length === 0) return;
                setAdded((prev) => (prev.includes(id) ? prev : [...prev, id]));
              }}
            >
              Add {catalogue?.label ?? 'connection'}
            </button>

            <p className="os-wiznote">
              Anything marked <strong style={{ fontWeight: 600, color: 'var(--ink)' }}>secret</strong> is
              handed straight to Windows and never shown again — not here, not in a report. Values
              marked safe to share are ordinary settings your app already publishes.
            </p>
          </div>
        )}

        {chip === 4 && step !== 'done' && (
          <div>
            <h2 className="os-wizh2">Check and add</h2>
            <p className="os-wizsub">Windows will ask permission once. Nothing is written before that.</p>
            <dl className="os-review">
              <dt>Project</dt><dd>{name.trim() || '—'}</dd>
              <dt>Kind</dt><dd>{kindLabel}</dd>
              <dt>Folder</dt><dd>{target || '—'}</dd>
              <dt>Known to ProjectOS as</dt>
              <dd>{projectId || '—'}   (you never type this)</dd>
              <dt>Connections</dt>
              <dd>
                {added.length === 0
                  ? 'None yet — you can add them later'
                  : added.map((id) => CONNECTION_CATALOGUE.find((c) => c.id === id)?.label ?? id).join(', ')}
              </dd>
              <dt>Live site</dt><dd>Frozen until you approve a change</dd>
            </dl>
            <button type="button" className="os-pri" style={{ height: 52, padding: '0 26px', fontSize: 16, borderRadius: 11 }} disabled={busy !== null} onClick={() => void addProject()}>
              Add project
            </button>
          </div>
        )}

        {step === 'done' && (
          <div>
            <div className="os-wizdone-head">
              <span className="os-tickcircle"><IconTick /></span>
              <h2>{name.trim()} is ready</h2>
            </div>
            <p className="os-wizsub">Added to your projects. Nothing runs until you ask it to.</p>
            <button type="button" className="os-pri" style={{ height: 52, padding: '0 26px', fontSize: 16, borderRadius: 11 }} onClick={() => onAdded?.(projectId)}>
              Open project
            </button>
          </div>
        )}

        {step !== 'done' && (
          <div className="os-wiznav">
            <button type="button" className="os-sec" onClick={goBack}>Back</button>
            <span className="os-wiznav-step">Step {chip} of 4</span>
            <button type="button" className="os-pri" disabled={nextBlocked} onClick={goNext}>{nextLabel}</button>
          </div>
        )}

        {busy !== null && <p className="os-wizbusy" role="status">{busy}</p>}
        {problem !== null && <p className="os-refusal failed" role="alert">{problem}</p>}
      </section>

      <details className="os-details">
        <summary>Advanced — what gets written</summary>
        <div className="os-details-grid">
          <span>registry entry</span><span className="v">machine scope, ACL protected — needs Windows permission</span>
          <span>.projectops/config.json</span><span className="v">written inside the chosen folder on first open</span>
          <span>phase manifest</span><span className="v">none until you state an objective</span>
          <span>production</span><span className="v">frozen</span>
          <span>keys</span><span className="v">Windows credential store, referenced by alias only</span>
        </div>
      </details>
    </div>
  );
}
