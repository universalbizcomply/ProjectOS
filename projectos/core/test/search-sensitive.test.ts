import { describe, expect, it } from 'vitest';
import { chunkRecordsOf, sensitiveContentProblem, sensitivePathProblem } from '../src/index.js';

// Each shape is assembled here, so no file in this repository holds one whole.
const AWS = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const AWS_SESSION = ['ASIA', 'IOSFODNN7EXAMPLE'].join('');
const GOOGLE = ['AIza', 'Sy'.padEnd(35, 'x')].join('');
const GITHUB = ['ghp', '_', 'a'.repeat(36)].join('');
const GITHUB_FINE = ['github', '_pat_', 'a'.repeat(30)].join('');
const SLACK = ['xoxb', '-', '123456789012-abcdef'].join('');
const OPENAI = ['sk', '-proj-', 'a'.repeat(24)].join('');
const ANTHROPIC = ['sk', '-ant-', 'a'.repeat(24)].join('');
const STRIPE = ['sk', '_live_', 'a'.repeat(24)].join('');
const NPM = ['npm', '_', 'a'.repeat(36)].join('');
const JWT = ['eyJ', 'a'.repeat(24), '.', 'b'.repeat(12), '.', 'c'.repeat(12)].join('');
const AZURE = ['AccountKey=', 'a'.repeat(44), '=='].join('');
const pem = (kind: string): string => [`-----BEGIN ${kind}-----`, 'MIIB', `-----END ${kind}-----`].join('\n');

describe('a file that holds a secret is refused at the index boundary', () => {
  it('ordinary prose passes: the positive control', () => {
    expect(sensitiveContentProblem('The quarterly budget review is on Tuesday. We rotate keys monthly.')).toBeNull();
    expect(sensitiveContentProblem('Tokens are counted by the tokenizer. Skip the password step.')).toBeNull();
    expect(sensitivePathProblem('docs/guide.md')).toBeNull();
    expect(sensitivePathProblem('docs/tokenizer-notes.md')).toBeNull();
    expect(sensitivePathProblem('docs/keyboard.md')).toBeNull();
    expect(sensitivePathProblem('sessions/one.jsonl')).toBeNull();
  });

  it.each([
    ['a private key', pem('RSA PRIVATE KEY')],
    ['an OpenSSH key', pem('OPENSSH PRIVATE KEY')],
    ['an encrypted key', pem('ENCRYPTED PRIVATE KEY')],
    ['a certificate', pem('CERTIFICATE')],
    ['an AWS key id', AWS],
    ['an AWS session key id', AWS_SESSION],
    ['a Google key', GOOGLE],
    ['an Azure account key', AZURE],
    ['a GitHub token', GITHUB],
    ['a GitHub fine-grained token', GITHUB_FINE],
    ['a Slack token', SLACK],
    ['an OpenAI key', OPENAI],
    ['an Anthropic key', ANTHROPIC],
    ['a Stripe key', STRIPE],
    ['an npm token', NPM],
    ['a JWT', JWT],
  ])('%s in the text is refused', (_name, secret) => {
    expect(sensitiveContentProblem(`Notes.\nkey: ${secret}\nMore notes.`)).toBe('secret-content');
  });

  it.each([
    'credentials.txt',
    'docs/credentials.md',
    'my-credentials.md',
    'aws_credentials.txt',
    'secrets.md',
    'secrets/notes.md',
    'passwords.txt',
    'passwd.txt',
    'api-keys.md',
    'api_key.txt',
    'apikeys.md',
    'private-key.txt',
    'tokens.txt',
    'id_rsa.txt',
    'server.pem',
    'server.key',
    'bundle.p12',
    'CREDENTIALS.TXT',
  ])('the name %s is refused', (path) => {
    expect(sensitivePathProblem(path)).toBe('credential-name');
  });

  it.each(['.env', '.env.md', '.git/notes.md', 'docs/.hidden/a.md', '.projectops/plan.md'])('the dot-segment in %s is refused', (path) => {
    expect(sensitivePathProblem(path)).toBe('dot-segment');
  });
});

describe('chunkRecordsOf holds the boundary', () => {
  const source = { project: 'alpha-project', source: 'documents' as const, path: 'docs/a.md', content: 'plain words' };

  it('a clean source makes records and skips nothing: the positive control', () => {
    expect(chunkRecordsOf(source)).toMatchObject({ ok: true, skipped: [], records: [{ path: 'docs/a.md' }] });
  });

  it('a credential name makes no record, and is skipped by name', () => {
    expect(chunkRecordsOf({ ...source, path: 'credentials.txt' })).toEqual({
      ok: true,
      records: [],
      skipped: [{ path: 'credentials.txt', reason: 'credential-name' }],
    });
  });

  it('secret content makes no record, and the skip holds none of it', () => {
    const result = chunkRecordsOf({ ...source, content: `words\n${AWS}\nwords` });

    expect(result).toEqual({ ok: true, records: [], skipped: [{ path: 'docs/a.md', reason: 'secret-content' }] });
    expect(JSON.stringify(result)).not.toContain(AWS);
  });

  it('a dot-segment makes no record, whoever handed it in', () => {
    expect(chunkRecordsOf({ ...source, path: '.git/notes.md' })).toEqual({
      ok: true,
      records: [],
      skipped: [{ path: '.git/notes.md', reason: 'dot-segment' }],
    });
  });
});

describe('the project store paths a rebuildable index cites (STORES1A)', () => {
  it('lets `.projectops` open a memory or session citation, because the real path is the citation', () => {
    expect(sensitivePathProblem('.projectops/execution/run-1.findings.json', 'sessions')).toBeNull();
    expect(sensitivePathProblem('.projectops/plan-0123456789abcdef-0123456789ab.json', 'memory')).toBeNull();
  });

  it('keeps it closed to a document and to a source that names none: the positive control', () => {
    expect(sensitivePathProblem('.projectops/plan-1.json', 'documents')).toBe('dot-segment');
    expect(sensitivePathProblem('.projectops/plan-1.json')).toBe('dot-segment');
  });

  it.each([
    ['another dot directory', '.git/config'],
    ['an environment file', '.env'],
    ['the store root under another dot name', '.projectops2/x.json'],
    ['a dot segment below the root', '.projectops/.hidden/x.json'],
    ['the root not first', 'docs/.projectops/x.json'],
    ['a credential name below the root', '.projectops/execution/credentials.json'],
  ])('still refuses %s, even as a memory or session source', (_label, path) => {
    expect(sensitivePathProblem(path, 'memory')).not.toBeNull();
    expect(sensitivePathProblem(path, 'sessions')).not.toBeNull();
  });

  it('judges the source kind at the index boundary, so a document cannot claim the path', () => {
    const asDocument = chunkRecordsOf({ project: 'alpha-project', source: 'documents', path: '.projectops/plan-1.json', content: 'plan text' });
    expect(asDocument).toMatchObject({ ok: true, records: [], skipped: [{ path: '.projectops/plan-1.json', reason: 'dot-segment' }] });
    const asMemory = chunkRecordsOf({ project: 'alpha-project', source: 'memory', path: '.projectops/plan-1.json', content: 'plan text' });
    expect(asMemory.ok && asMemory.records.length).toBe(1);
  });

  it('a secret in a store record still stops it', () => {
    const result = chunkRecordsOf({ project: 'alpha-project', source: 'sessions', path: '.projectops/execution/a.json', content: `key ${AWS}` });
    expect(result).toMatchObject({ ok: true, records: [], skipped: [{ reason: 'secret-content' }] });
  });
});

describe('an escaped secret, and the newer shapes, are refused (fix round 1, M3)', () => {
  const BS = String.fromCharCode(92);
  const body = 'a1b2'.repeat(8);
  const escaped = (text: string): string => [...text].map((c) => `${BS}u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');

  it.each([
    ['one letter escaped', `key ${BS}u0073k-ant-${body}`],
    ['every letter escaped', `key ${escaped(`sk-ant-${body}`)}`],
    ['escaped twice', `key ${BS}u005cu0073k-ant-${body}`],
    ['a private key header, escaped', escaped('-----BEGIN RSA PRIVATE KEY-----')],
    ['an AWS key id, escaped', escaped(AWS)],
  ])('refuses %s', (_label, text) => {
    expect(sensitiveContentProblem(text)).toBe('secret-content');
  });

  it.each([
    ['a Supabase secret key', `sb_secret_${body}`],
    ['a Supabase publishable key', `sb_publishable_${body}`],
    ['a Vercel token', `vcp_${'A1b2C3d4'.repeat(3)}`],
    ['a Resend key', `re_${'A1b2C3d4_'.repeat(3)}`],
  ])('refuses %s', (_label, secret) => {
    expect(sensitiveContentProblem(`Notes.\nkey: ${secret}\nMore.`)).toBe('secret-content');
  });

  it('does not refuse words that only start the same way: the positive control', () => {
    expect(sensitiveContentProblem('Use the re_run flag, or sb_secret_x, or vcp_short; prefix_re_something_longer_than_twenty_chars is a name.')).toBeNull();
    expect(sensitiveContentProblem(`A literal backslash-u sequence for a space: ${BS}u0020 and nothing else.`)).toBeNull();
  });
});

describe('ordinary snake_case is not a credential, real tokens still are (final round, N2)', () => {
  const body = 'A1b2C3d4'.repeat(4);

  it.each([
    'Call re_render_count_total_value after the update.',
    'The helper re_authenticate_user_with_session runs first.',
    'The setting sb_publishable_key_name_for_client_config is documented.',
    'The flag sb_secret_rotation_policy_for_service_roles is on.',
    'See vcp_deployment_configuration_for_production.',
    'Use re_render_v2_count_total_value_again for the v2 path.',
    'The name vcp_cache_invalidation_strategy_v2_final is a label.',
  ])('does not refuse %s', (text) => {
    expect(sensitiveContentProblem(text)).toBeNull();
  });

  it.each([
    ['a Resend key, mixed case with digits', `re_${body.slice(0, 24)}`],
    ['a Resend key with the underscore split', `re_${'Ab12Cd34'}_${'Ef56Gh78Ij90Kl12Mn34Op56'}`],
    ['a Supabase secret key', `sb_secret_${'a1b2'.repeat(8)}`],
    ['a Supabase publishable key', `sb_publishable_${'a1b2'.repeat(8)}`],
    ['a Vercel token', `vcp_${'A1b2C3d4'.repeat(3)}`],
  ])('still refuses %s', (_label, secret) => {
    expect(sensitiveContentProblem(`Notes ${secret} more`)).toBe('secret-content');
  });

  it.each([
    ['spaces-free runs of tokens', 'sb_secret_a-'.repeat(5000)],
    ['re_ then a long run', `re_${'a'.repeat(60000)}`],
    ['re_ then a long run with a late digit', `re_${'a'.repeat(60000)}1`],
    ['many re_ starts', `${'re_aaaaaaaaaaaaaaaaaaaaaaaaaaaaa '.repeat(2000)}`],
    ['sb_ starts joined by hyphens', 'sb_publishable_aaaaaaaaaaaaaaaaaaaaaaaaaaaa-'.repeat(1400)],
    ['vcp_ starts', 'vcp_aaaaaaaaaaaaaaaaaaaaaaaaaaaa '.repeat(2000)],
    ['one megabyte of one letter', 'a'.repeat(1_000_000)],
    ['one megabyte of underscores', '_'.repeat(1_000_000)],
  ])('ends quickly on %s', (_label, input) => {
    const started = Date.now();
    sensitiveContentProblem(input);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
