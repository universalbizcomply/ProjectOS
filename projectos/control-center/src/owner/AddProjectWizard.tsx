/**
 * Add Project — the whole thing, for someone who has never heard of a repository.
 *
 * WHAT THIS REPLACES. Four fields — a project id, an absolute path typed by hand, a set of
 * environment checkboxes and a freeze toggle — and a refusal that read
 * `ProposedEntryInvalid(GitMarkerMissing)` when the folder was not a repository. Everything in that
 * sentence is a thing the owner had to already understand.
 *
 * WHAT IT ASKS INSTEAD. What are you adding, what is it called, where is it. Then it looks, says
 * what it found in one sentence, offers to fix what is missing, collects any service keys, shows a
 * summary, and asks once.
 *
 * THIS COMPONENT STILL HAS NO AUTHORITY. Registration remains the bounded elevated helper behind a
 * real Windows prompt, exactly as before — this file names no helper, builds no command line and
 * carries no confirmation phrase, and an invariant test fails the build if a renderer source
 * mentions any of them. What changed is how much the owner has to know to get there.
 *
 * Created in PROJECTOS-SIMPLE-PROJECT-WIZARD1A.
 */
import { useState } from 'react';
import { tauriBridge } from '../daemon/tauriBridge';
import {
  CONNECTION_CATALOGUE,
  connectionSummary,
  credentialReference,
  newProjectPath,
  projectIdFrom,
  valuesToStore,
  type PendingValue,
} from './addProjectModel';

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

export function AddProjectWizard({ onAdded }: { onAdded?: (projectId: string) => void }) {
  const [step, setStep] = useState<Step>('type');
  const [kind, setKind] = useState<Kind>('existing');
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [parent, setParent] = useState('');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [values, setValues] = useState<readonly PendingValue[]>([]);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [prepared, setPrepared] = useState<readonly string[]>([]);
  const [typing, setTyping] = useState(false);

  const available = tauriBridge.isTauri();
  const projectId = projectIdFrom(name);
  const target = kind === 'new' ? newProjectPath(parent, name) : folder;
  // The one case where an absent folder is the expected state rather than a mistake.
  const willCreate = kind === 'new' && inspection !== null && inspection.readiness === 'NOT_A_FOLDER';

  async function browse(forParent: boolean): Promise<void> {
    setProblem(null);
    const title = forParent ? 'Choose where to create the project' : 'Choose the project folder';
    const picked = (await tauriBridge.invoke('pick_folder', { title })) as string | null;
    if (picked === null || picked === undefined) return; // cancelled — an ordinary outcome
    if (forParent) setParent(picked);
    else setFolder(picked);
  }

  async function look(): Promise<void> {
    setBusy('Checking the folder…');
    setProblem(null);
    try {
      const raw = (await tauriBridge.invoke('inspect_folder', { path: target })) as Record<string, unknown>;
      setInspection(toInspection(raw));
      setStep('check');
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function prepare(): Promise<void> {
    setBusy('Preparing the project…');
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
      // Values are stored AFTER the project exists: a credential reference names a project, and
      // storing one for a project that was never added would leave a key with nothing to belong to.
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
      <div className="wiz">
        <h3>Add a project</h3>
        <p className="muted">Adding a project needs the ProjectOS desktop app. This is a browser preview.</p>
      </div>
    );
  }

  return (
    <div className="wiz">
      {step === 'type' && (
        <>
          <h3>What are you adding?</h3>
          <div className="wiz-choices">
            <button type="button" className="wiz-choice" onClick={() => { setKind('existing'); setStep('name'); }}>
              <b>A project I already have</b>
              <span>The work is already in a folder on this computer.</span>
            </button>
            <button type="button" className="wiz-choice" onClick={() => { setKind('new'); setStep('name'); }}>
              <b>Something new</b>
              <span>ProjectOS will create the folder and set it up.</span>
            </button>
          </div>
        </>
      )}

      {step === 'name' && (
        <>
          <h3>What is it called?</h3>
          <input
            className="wiz-input"
            value={name}
            placeholder="ERP System"
            onChange={(e) => setName(e.target.value)}
            aria-label="Project name"
          />
          <p className="muted">This is the name you will see in your project list.</p>
          {advanced && projectId !== '' && <p className="muted">Internal id: {projectId}</p>}
          <div className="wiz-actions">
            <button type="button" className="ghost" onClick={() => setStep('type')}>Back</button>
            <button type="button" className="primary" disabled={projectId === ''} onClick={() => setStep('folder')}>
              Continue
            </button>
          </div>
        </>
      )}

      {step === 'folder' && (
        <>
          <h3>{kind === 'new' ? 'Where should it go?' : 'Where is it?'}</h3>
          {kind === 'new' ? (
            <>
              <button type="button" className="wiz-browse" onClick={() => void browse(true)}>Choose location…</button>
              <p className="wiz-path">{parent === '' ? 'No location chosen yet' : parent}</p>
              {typing ? (
                <input
                  className="wiz-input"
                  value={parent}
                  placeholder="C:\dev"
                  onChange={(e) => setParent(e.target.value)}
                  aria-label="Project location"
                />
              ) : (
                <button type="button" className="linkbtn" onClick={() => setTyping(true)}>
                  Or type the location instead
                </button>
              )}
              {target !== '' && <p className="muted">ProjectOS will create: {target}</p>}
            </>
          ) : (
            <>
              <button type="button" className="wiz-browse" onClick={() => void browse(false)}>Browse…</button>
              <p className="wiz-path">{folder === '' ? 'No folder chosen yet' : folder}</p>
              {/* TYPING IS AN OPT-IN, NEVER THE DEFAULT. Browsing is how this is meant to be used;
                  this exists for the owner who already has the path on their clipboard, and for
                  anyone who cannot operate a file dialog comfortably. */}
              {typing ? (
                <input
                  className="wiz-input"
                  value={folder}
                  placeholder="C:\dev\My Project"
                  onChange={(e) => setFolder(e.target.value)}
                  aria-label="Project folder"
                />
              ) : (
                <button type="button" className="linkbtn" onClick={() => setTyping(true)}>
                  Or type the location instead
                </button>
              )}
            </>
          )}
          <div className="wiz-actions">
            <button type="button" className="ghost" onClick={() => setStep('name')}>Back</button>
            <button type="button" className="primary" disabled={target === '' || busy !== null} onClick={() => void look()}>
              Continue
            </button>
          </div>
        </>
      )}

      {step === 'check' && inspection !== null && (
        <>
          {/* A NEW PROJECT'S FOLDER DOES NOT EXIST YET, AND THAT IS NOT A PROBLEM.
              `inspect_folder` correctly answers "that folder is not on this computer" — true, and
              exactly the wrong thing to say to someone who just asked ProjectOS to create it. Read
              literally it also offered no way forward, because Prepare was only shown for a folder
              that already existed. So the new-project case is named for what it is: nothing is here
              yet, which is the one situation in which nothing can possibly be overwritten. */}
          <h3>{willCreate ? 'ProjectOS will set this up' : 'ProjectOS checked this folder'}</h3>
          <p className="wiz-summary">
            {willCreate ? 'This folder does not exist yet, so ProjectOS will create it.' : inspection.summary}
          </p>
          <ul className="wiz-findings">
            {(willCreate
              ? ['The folder will be created', 'Project tracking will be started', 'ProjectOS setup will be added']
              : inspection.findings
            ).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {prepared.length > 0 && (
            <ul className="wiz-findings done">
              {prepared.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          <p className="muted">
            {willCreate ? 'Nothing is here yet, so nothing can be changed or removed.' : inspection.nextStep}
          </p>

          {advanced && (
            <div className="wiz-advanced">
              <div>Project history: {inspection.gitMarker === 'none' ? 'none' : inspection.gitMarker}</div>
              <div>ProjectOS setup: {inspection.hasProjectops ? 'present' : 'absent'}</div>
              {inspection.declaredProjectId && <div>Declared id: {inspection.declaredProjectId}</div>}
              {inspection.branch && <div>Branch: {inspection.branch}</div>}
              {inspection.remote && <div>Remote: {inspection.remote}</div>}
              {inspection.dirtyCount !== null && <div>Uncommitted entries: {inspection.dirtyCount}</div>}
              {inspection.registeredAs && <div>Registered as: {inspection.registeredAs}</div>}
            </div>
          )}

          <div className="wiz-actions">
            <button type="button" className="ghost" onClick={() => setStep('folder')}>Back</button>
            {(inspection.readiness === 'NEEDS_PREPARATION' || willCreate) && (
              <button type="button" className="primary" disabled={busy !== null} onClick={() => void prepare()}>
                Prepare project
              </button>
            )}
            {inspection.readiness === 'READY' && (
              <button type="button" className="primary" onClick={() => setStep('connections')}>Continue</button>
            )}
          </div>
        </>
      )}

      {step === 'connections' && (
        <>
          <h3>Does this project use any services?</h3>
          <p className="muted">You can add these later. Nothing here is required.</p>
          <div className="wiz-conn-picker">
            {CONNECTION_CATALOGUE.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`wiz-chip${chosen.includes(c.id) ? ' on' : ''}`}
                onClick={() =>
                  setChosen((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]))
                }
              >
                {c.label}
              </button>
            ))}
          </div>

          {chosen.map((id) => {
            const c = CONNECTION_CATALOGUE.find((x) => x.id === id);
            if (!c) return null;
            return (
              <div className="wiz-conn" key={id}>
                <h4>{c.label}</h4>
                {c.fields.map((f) => (
                  <label className="wiz-field" key={f.key}>
                    <span>
                      {f.label}
                      {f.kind === 'secret' && <em className="wiz-secret"> · kept secret</em>}
                    </span>
                    <input
                      type={f.kind === 'secret' ? 'password' : 'text'}
                      value={valueOf(c.id, f.key)}
                      onChange={(e) => setValue(c.id, f.key, f.label, f.kind, e.target.value)}
                      autoComplete="off"
                    />
                    {f.hint && <small className="muted">{f.hint}</small>}
                  </label>
                ))}
                {c.custom && (
                  <CustomFields
                    provider={c.id}
                    values={values}
                    onChange={(key, label, v) => setValue(c.id, key, label, 'secret', v)}
                  />
                )}
              </div>
            );
          })}

          <div className="wiz-actions">
            <button type="button" className="ghost" onClick={() => setStep('check')}>Back</button>
            <button type="button" className="ghost" onClick={() => setStep('review')}>Skip for now</button>
            <button type="button" className="primary" onClick={() => setStep('review')}>Continue</button>
          </div>
        </>
      )}

      {step === 'review' && (
        <>
          <h3>Ready to add {name.trim()}</h3>
          <dl className="wiz-review">
            <dt>Project</dt>
            <dd>{name.trim()}</dd>
            <dt>Folder</dt>
            <dd>{target}</dd>
            <dt>Type</dt>
            <dd>{kind === 'new' ? 'New project' : 'Existing project'}</dd>
            <dt>ProjectOS setup</dt>
            <dd>{prepared.length > 0 ? 'Prepared' : 'Already present'}</dd>
            <dt>Services</dt>
            <dd>
              {chosen.length === 0
                ? 'None'
                : chosen
                    .map((id) => {
                      const label = CONNECTION_CATALOGUE.find((c) => c.id === id)?.label ?? id;
                      return `${label} — ${connectionSummary(id, values)}`;
                    })
                    .join(' · ')}
            </dd>
            <dt>Production</dt>
            <dd>Off</dd>
          </dl>
          <div className="wiz-actions">
            <button type="button" className="ghost" onClick={() => setStep('connections')}>Back</button>
            <button type="button" className="primary" disabled={busy !== null} onClick={() => void addProject()}>
              Add project
            </button>
          </div>
        </>
      )}

      {step === 'done' && (
        <>
          <h3>{name.trim()} is ready</h3>
          <p className="muted">You can open it and start working.</p>
          <div className="wiz-actions">
            <button type="button" className="primary" onClick={() => onAdded?.(projectId)}>Open project</button>
          </div>
        </>
      )}

      {busy !== null && <p className="wiz-busy">{busy}</p>}
      {problem !== null && <p className="wiz-problem">{problem}</p>}

      <button type="button" className="linkbtn wiz-adv-toggle" onClick={() => setAdvanced((a) => !a)}>
        {advanced ? 'Hide technical details' : 'Technical details'}
      </button>
    </div>
  );
}

/** Rows for a service ProjectOS does not know about. The owner names each value. */
function CustomFields({
  provider,
  values,
  onChange,
}: {
  provider: string;
  values: readonly PendingValue[];
  onChange: (key: string, label: string, value: string) => void;
}) {
  const mine = values.filter((v) => v.provider === provider);
  const [rows, setRows] = useState<number>(Math.max(1, mine.length));
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div className="wiz-custom-row" key={i}>
          <input
            placeholder="What is it called?"
            defaultValue={mine[i]?.label ?? ''}
            onChange={(e) => onChange(`custom-${i}`, e.target.value, mine[i]?.value ?? '')}
            aria-label="Value name"
          />
          <input
            type="password"
            placeholder="Value"
            onChange={(e) => onChange(`custom-${i}`, mine[i]?.label ?? `Value ${i + 1}`, e.target.value)}
            aria-label="Value"
            autoComplete="off"
          />
        </div>
      ))}
      <button type="button" className="linkbtn" onClick={() => setRows((r) => r + 1)}>
        Add another value
      </button>
    </>
  );
}
