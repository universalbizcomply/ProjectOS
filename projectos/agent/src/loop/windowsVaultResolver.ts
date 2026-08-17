/**
 * Resolving the gatekeeper credential from the vault ProjectOS already has.
 *
 * NOTHING NEW STORES A SECRET HERE. `projectos/credentials/windows-credential-store.ps1` already
 * calls `CredReadW`/`CredWriteW` through `advapi32.dll`, is reachable in a default build through the
 * `npm run credentials` script, and enforces the rules that matter: the value is never a command-line
 * argument, `set` reads it from an environment variable set on the child alone, `get` writes it to
 * stdout and nothing else, and `list` returns names only. Building a second store would have meant a
 * second file format, a second ACL decision, a second rotation path and a second thing to get wrong.
 *
 * TWO NAMING CONVENTIONS MEET IN EXACTLY ONE PLACE. Governed configuration names a credential in the
 * agent's UPPER_SNAKE form, which is the only shape `checkTransportDescriptor` will accept in a
 * descriptor; the vault addresses credentials by a slash-separated reference carrying project,
 * environment and provider. `VAULT_REFERENCE` below is the whole of the mapping, deliberately a
 * frozen table rather than a rule, so a new credential is a visible diff and a typo cannot silently
 * address a different secret.
 *
 * WHAT THE OWNER MUST HAVE DONE FIRST. The credential is `operation` class in the vault's own
 * classification, which means it may never be projected into a child process's environment, and this
 * resolver requires the owner's `secrets-handling` gate receipt before it will ask for the value at
 * all. That receipt is a committed record; the agent cannot write itself one that counts.
 *
 * THE HONEST CEILING, STATED. On this machine the secret is protected from other USERS and not from
 * this user: `CredReadW` returns it to any process running as the owner, with no prompt. Windows 11
 * Home offers no Credential Guard and no service-account isolation, and the decided
 * `NT SERVICE\ProjectOSHost` custody model is not implemented — its Rust composition crate has no
 * dependents and the shipped host binary compiles none of it. The compensating controls are on the
 * provider side: a least-privilege project role, a hard spend limit, and rotation. That is an
 * accepted risk, not a mitigated one, and it is written here so nobody has to rediscover it.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */
import { join } from 'node:path';
import type { System } from '../system.js';
import {
  credentialRefProblems,
  type CredentialResolution,
  type CredentialResolver,
} from './credentialResolver.js';

/**
 * The only place the agent's reference names and the vault's references meet.
 *
 * A TABLE, NOT A TRANSFORMATION. A rule that derived one from the other would quietly produce a
 * plausible reference for a name nobody provisioned, and the failure would arrive as "credential
 * missing" rather than "that is not a credential this project has".
 *
 * WHY `development` AND NOT `production`. The third segment is the ENVIRONMENT, per the reference
 * grammar in `projectos/credentials/reference.cjs` — `ProjectOS/<project>/<environment>/<provider>/
 * <credential>`, with `ENVIRONMENTS` frozen to development, staging, production and anything else
 * refused. This programme's approved plan declares exactly one environment, `local`, with
 * `productionFreeze: true`. `local` is not a value the grammar accepts, so the truthful designation
 * within the vocabulary that exists is `development`.
 *
 * An earlier version of this table said `production`, justified by the idea that the segment
 * described the system being authenticated to rather than the environment ProjectOS is running in.
 * The module's own grammar says otherwise, and writing `production` into a governed reference under
 * a production freeze would have made the first production-designated credential in this repository
 * a false one. The risk classification is unaffected: `gatekeeper-api-key` is not on the session
 * allowlist, so it classifies `operation` either way and can never be projected into a child
 * environment.
 */
export const VAULT_REFERENCE: Readonly<Record<string, string>> = Object.freeze({
  OPENAI_GATEKEEPER_KEY: 'ProjectOS/projectos/development/openai/gatekeeper-api-key',
});

export interface WindowsVaultResolverOptions {
  readonly sys: System;
  readonly root: string;
  /**
   * Whether the owner's committed `secrets-handling` gate receipt approves credential use.
   *
   * ESTABLISHED BY THE CALLER FROM A COMMITTED RECEIPT, never asserted by the agent about itself.
   * `false` here is a refusal, not a prompt.
   */
  readonly ownerConfirmation: boolean;
}

/** Fixed refusal texts. A caught error's own message is never repeated — it could quote the value. */
const REFUSALS = {
  unmapped: (ref: string) =>
    `credential '${ref}' is not a credential this project holds; the reference table names ` +
    `${Object.keys(VAULT_REFERENCE).join(', ') || 'none'}`,
  noOwner:
    'the owner has not approved credential use for this phase; a committed secrets-handling gate ' +
    'receipt is required before the gatekeeper credential may be read',
  unavailable:
    'the Windows Credential Manager could not be reached, and no weaker store is substituted',
  missing:
    'no value is stored under this reference; provision it with the credentials command before the ' +
    'gatekeeper is used',
} as const;

/**
 * A resolver backed by the existing Windows Credential Manager adapter.
 *
 * The value exists only inside `use()`. It is not returned, not stored on the resolver, and never
 * placed in a refusal — including the refusal produced when the store itself fails, which is why the
 * texts above are fixed rather than built from a caught message.
 */
export function windowsVaultResolver(options: WindowsVaultResolverOptions): CredentialResolver {
  return {
    resolve(ref: string): CredentialResolution {
      const shapeProblems = credentialRefProblems(ref);
      if (shapeProblems.length > 0) return { ok: false, reasons: shapeProblems };

      const vaultRef = VAULT_REFERENCE[ref];
      if (vaultRef === undefined) return { ok: false, reasons: [REFUSALS.unmapped(ref)] };

      // THE OWNER GATE COMES BEFORE THE STORE IS TOUCHED. Asking for the value and then deciding
      // whether we were allowed to would already have read it.
      if (options.ownerConfirmation !== true) return { ok: false, reasons: [REFUSALS.noOwner] };

      const script = join(options.root, 'projectos', 'credentials', 'windows-credential-store.ps1');
      if (!options.sys.exists(script)) {
        return { ok: false, reasons: [REFUSALS.unavailable] };
      }

      const result = options.sys.exec(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, 'get', '-Target', vaultRef],
        // The credential scrubber strips credential-shaped NAMES from the child's environment. It is
        // asked for here too: this child has no business inheriting any other process's key.
        { scrubCredentials: true, cwd: options.root },
      );

      if (result.code !== 0) {
        // `stderr` may name the reference but must never be echoed wholesale — a failing store has
        // been known to include the value it was handling.
        return { ok: false, reasons: [REFUSALS.unavailable] };
      }
      const value = result.stdout.replace(/\r?\n$/, '');
      if (value === '') return { ok: false, reasons: [REFUSALS.missing] };

      return { ok: true, use: (fn) => fn(value) };
    },
  };
}
