/**
 * Getting at a secret without ever holding one.
 *
 * THE OWNER'S CONSTRAINT IS THE DESIGN. The implementer must never create, read or print an API
 * secret, and the owner must never be asked to put one in a repository file, a prompt, a report or
 * ordinary plaintext config. That rules out the obvious shapes — a config value, an env var read at
 * startup, a `.env` — and leaves exactly one: configuration names a secret, and something outside the
 * repository resolves that name at the moment of use.
 *
 * WHY `use(fn)` RATHER THAN `getSecret(): string`. A function that RETURNS the secret puts it in a
 * variable, and a variable ends up in a log line, an error message, a record, a stack trace or a
 * report eventually — not through malice but through the ordinary drift of code. Scoped access keeps
 * the value inside a callback the resolver controls, so the only thing that escapes is whatever the
 * callback returns. That is a convention, not a cage: a determined caller can return the secret
 * itself. It is written this way because the failure being defended against is carelessness, and this
 * is the shape that makes the careless thing the awkward one.
 *
 * A FAILURE IS A REFUSAL, NEVER A FALLBACK. No environment-variable second chance, no prompt, no
 * empty string. A transport that cannot resolve its credential does not run, and the reason says
 * which reference failed WITHOUT saying anything about its value — including whether it exists.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN: any code that reads a real secret store. The port is
 * here so everything upstream can be built and tested with no secret on the machine; the concrete
 * store is chosen and wired at the credential boundary, which is the owner's step.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */

/** A reference NAMES a secret. It is not, and can never be, the secret. */
export interface CredentialRef {
  readonly ref: string;
}

/**
 * The shape a reference must take.
 *
 * Deliberately narrow and deliberately UPPER_SNAKE: a reference is an identifier that appears in
 * governed configuration and in the owner's provisioning instructions, and both are easier to get
 * right when there is only one possible spelling.
 */
const REF_SHAPE = /^[A-Z][A-Z0-9_]{7,63}$/;

/** Shapes that mean somebody put the secret where the reference belongs. */
const LOOKS_LIKE_A_SECRET = /(sk-|sk-ant-|eyJ|ghp_|AKIA|xox|AIza|-----BEGIN)/;

export type CredentialResolution =
  | {
      readonly ok: true;
      /**
       * Run `fn` with the secret. The secret is not returned, stored or logged by the resolver.
       * Whatever `fn` returns is the caller's; the secret itself must not be it.
       */
      readonly use: <T>(fn: (secret: string) => T) => T;
    }
  | { readonly ok: false; readonly reasons: readonly string[] };

export interface CredentialResolver {
  /** Resolve a named secret, or refuse. Never throws; never includes the value in a refusal. */
  resolve(ref: string): CredentialResolution;
}

/**
 * Why this reference is not usable as a reference, or `[]` when it is.
 *
 * Checked BEFORE any store is consulted, so a malformed or secret-bearing reference never reaches
 * the resolver — and in particular never reaches a resolver that might log what it was asked for.
 */
export function credentialRefProblems(ref: unknown): readonly string[] {
  if (typeof ref !== 'string' || ref.trim() === '') {
    return ['no credential reference was configured, and a transport without one cannot be called'];
  }
  const value = ref.trim();
  const problems: string[] = [];

  // THE MOST IMPORTANT CHECK IN THE FILE. If configuration holds a key where it should hold a name,
  // refusing loudly is the only safe answer — and the refusal must not echo the value.
  if (LOOKS_LIKE_A_SECRET.test(value)) {
    problems.push(
      'the configured credential reference looks like a secret rather than a name; ProjectOS ' +
        'configuration names a credential and never holds one (the value is not repeated here)',
    );
    return problems;
  }
  if (!REF_SHAPE.test(value)) {
    problems.push(
      `credential reference ${JSON.stringify(value)} is not a valid reference name ` +
        '(UPPER_SNAKE_CASE, 8 to 64 characters, starting with a letter)',
    );
  }
  return problems;
}

/**
 * A resolver that holds nothing and refuses everything, with a reason.
 *
 * THE DEFAULT, AND NOT A PLACEHOLDER. Until the owner has provisioned a credential there IS no
 * secret, and the honest behaviour is to refuse and say why. Wiring a resolver that quietly returns
 * an empty string, or falls back to an environment variable, would turn "not provisioned yet" into a
 * call that fails somewhere further away with a worse message.
 */
export function unprovisionedResolver(detail: string): CredentialResolver {
  return {
    resolve(ref: string): CredentialResolution {
      const problems = credentialRefProblems(ref);
      if (problems.length > 0) return { ok: false, reasons: problems };
      return {
        ok: false,
        reasons: [
          `credential '${ref}' has not been provisioned on this machine: ${detail}`,
          'no fallback is attempted; an unattended reviewer does not run on a guessed credential',
        ],
      };
    },
  };
}

/**
 * A resolver backed by a value the CALLER already holds. For tests only.
 *
 * Exported so the whole transport can be exercised deterministically without a real secret and
 * without the test reaching into a real store. It is named to be obvious in a diff: a production
 * call site using this would be visible at the owner's commit gate.
 */
export function inMemoryResolverForTests(ref: string, secret: string): CredentialResolver {
  return {
    resolve(asked: string): CredentialResolution {
      const problems = credentialRefProblems(asked);
      if (problems.length > 0) return { ok: false, reasons: problems };
      if (asked !== ref) return { ok: false, reasons: [`credential '${asked}' is not held by this resolver`] };
      return { ok: true, use: (fn) => fn(secret) };
    },
  };
}
