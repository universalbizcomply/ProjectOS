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
 * WHERE git RUNS IS PART OF THE BINDING, NOT AN ACCIDENT. Binding only the executable left half the
 * problem open. The packaged daemon is launched with its working directory set to the runtime
 * payload root, which is not a repository at all; every git call that named its repository with
 * `-C <root>` kept working, and every call that relied on an ambient working directory — the CLI's
 * legitimate assumption — silently ran in `…\runtime-payload` and got `fatal: not a git repository`.
 * That surfaced to the owner as `REPOSITORY_FACTS_UNAVAILABLE` when submitting the first objective
 * from the packaged interface: a missing capability wearing the costume of a governance refusal.
 *
 * So the governed project root is bound HERE, at the one seam every git call already passes through,
 * rather than by threading a cwd through each of the callers that assumed one. An explicit
 * `options.cwd` still wins, and an argv `-C` still wins over both because git acts on it first.
 *
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A; working directory bound in
 * PROJECTOS-RECOVERY-EXTERNAL-PROJECT1A.
 */
export function gitBoundSystem(base, env = process.env, projectRoot) {
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

      // A root that is not absolute would be resolved against whatever directory the daemon happens
      // to have been started in — which is the exact defect this binding exists to close, so it is
      // refused rather than quietly ignored. Absent (the CLI, which is legitimately cwd-rooted) is
      // not the same as present-and-wrong, and only the latter is an error.
      if (projectRoot !== undefined && (typeof projectRoot !== 'string' || !isAbsolute(projectRoot))) {
        return {
          code: 127,
          stdout: '',
          stderr:
            'ProjectOS has no absolute governed project root, so repository facts cannot be established.',
        };
      }

      const bindCwd = projectRoot !== undefined && options?.cwd === undefined;
      return base.exec(bound, args, bindCwd ? { ...options, cwd: projectRoot } : options);
    },
  };
}
