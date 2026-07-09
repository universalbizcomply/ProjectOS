import { useState, type FormEvent } from 'react';
import { updatePassword, signOut } from './data/auth';

/** Shown as a forced screen on first login, or opened manually from the sidebar. */
export function ChangePassword({ forced, onDone }: { forced: boolean; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) return setError('Use at least 8 characters.');
    if (pw !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    const { error } = await updatePassword(pw);
    setBusy(false);
    if (error) return setError(error);
    onDone();
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand">
          <b>ProjectOS</b>
          <span>Control</span>
        </div>
        <h1>{forced ? 'Set a new password' : 'Change password'}</h1>
        <p className="login-sub">
          {forced ? 'First sign-in — please choose your own password.' : 'Update your password.'}
        </p>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            required
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
        <div className="login-foot">
          {forced ? (
            <span className="signout" onClick={() => void signOut()}>Sign out instead</span>
          ) : (
            <span className="signout" onClick={onDone}>Cancel</span>
          )}
        </div>
      </form>
    </div>
  );
}
