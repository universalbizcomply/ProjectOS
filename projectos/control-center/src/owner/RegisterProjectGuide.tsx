/**
 * Register a new project — a command BUILDER, never a command RUNNER.
 *
 * Registering a project writes to the ACL-protected installation registry, and that path is
 * deliberately terminal-only: `projectos-register-project` (PROJECTOS-PHASE6-SECTION-C) refuses
 * piped/redirected input and requires a confirmation phrase typed at a real console, stating
 * explicitly that "an approval that can be automated is not a confirmation" and that the program
 * has "no self-elevation anywhere". Nothing here works around that — it stays a real Administrator
 * terminal action.
 *
 * What this DOES do: turn "figure out the exact command yourself" into "read it off the screen".
 * The owner types the project id / repository root / environments / frozen state once here; this
 * renders the exact `plan` command (read-only, prints a digest) and, once that digest is pasted
 * back in, the exact `publish` command (the one that actually writes) — both ready to copy into an
 * Administrator terminal. No network call, no file access, no governed command dispatch: this is
 * string formatting over local component state and nothing else.
 */
import { useState } from 'react';

const ENVIRONMENTS = ['development', 'staging', 'production'] as const;

/** PowerShell single-quoted literal: wrap in `'...'`, double any embedded `'`. Matches ps_literal in admin.rs. */
function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ocp-btn"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? 'Copied' : 'Copy command'}
    </button>
  );
}

export function RegisterProjectGuide() {
  const [id, setId] = useState('');
  const [root, setRoot] = useState('');
  const [envs, setEnvs] = useState<readonly string[]>(['development']);
  const [frozen, setFrozen] = useState(true);
  const [digest, setDigest] = useState('');

  const ready = id.trim() !== '' && root.trim() !== '' && envs.length > 0;
  const envArg = envs.join(',');

  const planCommand = ready
    ? `projectos-register-project plan --id ${psLiteral(id.trim())} --root ${psLiteral(root.trim())} --environments ${psLiteral(envArg)} --frozen ${frozen}`
    : '';
  const publishCommand =
    ready && digest.trim() !== ''
      ? `projectos-register-project publish --id ${psLiteral(id.trim())} --root ${psLiteral(root.trim())} --environments ${psLiteral(envArg)} --frozen ${frozen} --expect-digest ${digest.trim()}`
      : '';

  function toggleEnv(name: string) {
    setEnvs((prev) => (prev.includes(name) ? prev.filter((e) => e !== name) : [...prev, name]));
  }

  return (
    <details className="ocp-panel preview">
      <summary>
        Register a new project
        <span className="ocp-example-tag">Needs an Administrator terminal</span>
      </summary>
      <p className="ocp-empty">
        ProjectOS keeps the list of projects it may govern in a protected location an ordinary
        session cannot write to, on purpose. This builds the exact two commands an administrator
        runs once, in an Administrator terminal, to add a project — you do not have to remember the
        flags. Nothing on this page runs them or touches that registry.
      </p>

      <div className="ocp-regform">
        <label>
          <span>Project id</span>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. my-app" />
        </label>
        <label>
          <span>Repository root (full path)</span>
          <input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="C:\dev\my-app" />
        </label>
        <fieldset className="ocp-regform-envs">
          <legend>Environments</legend>
          {ENVIRONMENTS.map((name) => (
            <label key={name} className="ocp-regform-check">
              <input type="checkbox" checked={envs.includes(name)} onChange={() => toggleEnv(name)} />
              <span>{name}</span>
            </label>
          ))}
        </fieldset>
        <label className="ocp-regform-check">
          <input type="checkbox" checked={frozen} onChange={(e) => setFrozen(e.target.checked)} />
          <span>Production frozen</span>
        </label>
      </div>

      {!ready && <p className="ocp-sub">Fill in a project id, repository root and at least one environment.</p>}

      {ready && (
        <>
          <p className="ocp-sub">
            Step 1 — run this in an Administrator terminal. It is read-only: it prints the proposed
            registration and a digest, and changes nothing.
          </p>
          <pre className="ocp-run-output">{planCommand}</pre>
          <div className="ocp-actionrow">
            <CopyButton text={planCommand} />
          </div>

          <label className="ocp-regform-digest">
            <span>Digest printed by plan (paste to build the publish command)</span>
            <input value={digest} onChange={(e) => setDigest(e.target.value)} placeholder="64 hex characters" />
          </label>

          {publishCommand !== '' && (
            <>
              <p className="ocp-sub">
                Step 2 — run this to actually register the project. It re-checks everything itself
                and asks for a typed confirmation before writing.
              </p>
              <pre className="ocp-run-output">{publishCommand}</pre>
              <div className="ocp-actionrow">
                <CopyButton text={publishCommand} />
              </div>
            </>
          )}
        </>
      )}
    </details>
  );
}
