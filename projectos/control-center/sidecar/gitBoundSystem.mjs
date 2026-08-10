import { isAbsolute, basename } from 'node:path';

/**
 * The agent `System`, with `git` bound to the ABSOLUTE executable the host resolved.
 *
 * WHY THIS EXISTS. The daemon is launched with no PATH — deliberately, so it cannot inherit the
 * developer's GitHub, Supabase, Vercel, AWS or npm credentials. But the closure gate derives its
 * facts (head, working-tree cleanliness, remote reconciliation, ancestry) by running git, and a bare
 * `git` cannot be found without a PATH. Every one of those facts then failed closed, and G4 refused
 * a phase whose tree was in fact clean and reconciled.
 *
 * So the HOST resolves exactly one absolute `git.exe` and passes it in `PROJECTOS_GIT_EXE`. This
 * redirects that single command to it and leaves every other command untouched.
 *
 * There is deliberately NO fallback to an ambient PATH. If the bound path is absent or does not look
 * like git, the exec FAILS and the gate goes on refusing — which is the correct outcome. Silently
 * searching for something else named `git` would be how a different executable ends up deciding
 * whether a phase may close.
 *
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */
export function gitBoundSystem(base, env = process.env) {
  return {
    ...base,
    exec(command, args, options) {
      if (command !== 'git') return base.exec(command, args, options);

      const bound = env.PROJECTOS_GIT_EXE;
      const valid =
        typeof bound === 'string' &&
        bound.length > 0 &&
        isAbsolute(bound) &&
        /^git\.exe$/i.test(basename(bound));
      if (!valid) {
        return {
          code: 127,
          stdout: '',
          stderr:
            'ProjectOS has no bound Git executable, so repository facts cannot be established.',
        };
      }
      return base.exec(bound, args, options);
    },
  };
}
