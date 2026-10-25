import { useState, type FormEvent } from 'react';
import { signIn } from './data/auth';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email.trim(), password);
    if (error) {
      setError(error);
      setBusy(false);
    }
    // on success, the auth listener in App swaps to the dashboard
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand">
          <b>ProjectOS</b>
          <span>Control</span>
        </div>
        <h1>Sign in</h1>
        <p className="login-sub">Owner access to Mission Control</p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="login-error" role="alert">{error}</div>}
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="login-foot">Execution stays owner-gated · read-only visibility</div>
      </form>
    </div>
  );
}
