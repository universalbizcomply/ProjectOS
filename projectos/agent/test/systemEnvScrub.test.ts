/**
 * The environment a worker or a check inherits.
 *
 * `spawnSync` inherits the whole parent environment by default, so an `ANTHROPIC_API_KEY` a
 * developer set for unrelated tooling would be handed to the Claude worker and to every validator
 * script in the governed checkout — while this project forbids `use-anthropic-api` outright. Found
 * by security review.
 *
 * Names only are inspected; a value is never read, matched or logged.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import { describe, it, expect } from 'vitest';
import { scrubbedEnv, CREDENTIAL_ENV_NAME } from '../src/system.js';

describe('scrubbedEnv', () => {
  it('drops credential-shaped variable names and keeps everything else', () => {
    const scrubbed = scrubbedEnv({
      PATH: '/usr/bin',
      SystemRoot: 'C:/Windows',
      ANTHROPIC_API_KEY: 'sk-ant-live',
      GITHUB_TOKEN: 'ghp_x',
      AWS_SECRET_ACCESS_KEY: 'x',
      DB_PASSWORD: 'x',
      NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org',
    });
    expect(Object.keys(scrubbed).sort()).toEqual(['NPM_CONFIG_REGISTRY', 'PATH', 'SystemRoot']);
  });

  it('does not inspect values — a variable is judged by its name alone', () => {
    const scrubbed = scrubbedEnv({ HARMLESS: 'sk-ant-looks-like-a-key-but-is-not-named-one' });
    expect(scrubbed['HARMLESS']).toBe('sk-ant-looks-like-a-key-but-is-not-named-one');
  });

  it('matches the names that actually carry secrets in this environment', () => {
    for (const n of ['API_KEY', 'anthropic_api_key', 'MY_TOKEN', 'SECRET_X', 'PASSWORD', 'AUTH_HEADER']) {
      expect(CREDENTIAL_ENV_NAME.test(n), n).toBe(true);
    }
    for (const n of ['PATH', 'HOME', 'TEMP', 'NODE_ENV']) {
      expect(CREDENTIAL_ENV_NAME.test(n), n).toBe(false);
    }
  });
});
