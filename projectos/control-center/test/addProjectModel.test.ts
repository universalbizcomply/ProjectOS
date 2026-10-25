/**
 * The rules an owner never sees, and must never have to.
 *
 * A project id, a credential reference and the secret/config split are all derived here from the
 * two things the owner actually supplies: a name and a folder. If any of these are wrong the owner
 * finds out much later, somewhere that cannot explain itself — a credential stored under a
 * mistyped reference simply reads as "missing" forever.
 */
import { describe, it, expect } from 'vitest';
import {
  CONNECTION_CATALOGUE,
  connectionSummary,
  credentialReference,
  newProjectPath,
  projectIdFrom,
  valuesToStore,
  type PendingValue,
} from '../src/owner/addProjectModel';

describe('projectIdFrom — the owner never invents an id', () => {
  it('derives the id the real project already declares', () => {
    // These are this machine's actual projects; the derived id must match what their own
    // .projectops declares, or adding them would create a second logical project.
    expect(projectIdFrom('ERP System')).toBe('erp-system');
    expect(projectIdFrom('Boithok Khana')).toBe('boithok-khana');
    expect(projectIdFrom('Trading Bot')).toBe('trading-bot');
    expect(projectIdFrom('BizComply V2')).toBe('bizcomply-v2');
    expect(projectIdFrom('PolyGo')).toBe('polygo');
    expect(projectIdFrom('TKN')).toBe('tkn');
  });

  it('collapses punctuation and spacing rather than producing a broken id', () => {
    expect(projectIdFrom('  My   Project!!  ')).toBe('my-project');
    expect(projectIdFrom('a//b__c')).toBe('a-b-c');
  });

  it('returns empty for a name that was never given, instead of a plausible id', () => {
    expect(projectIdFrom('')).toBe('');
    expect(projectIdFrom('   ')).toBe('');
    expect(projectIdFrom('!!!')).toBe('');
  });
});

describe('newProjectPath — the folder is named after the project, not the id', () => {
  it('uses the name the owner typed, so they can find it on disk', () => {
    expect(newProjectPath('C:\\dev', 'ERP System')).toBe('C:\\dev\\ERP System');
  });

  it('tolerates a trailing separator on the chosen location', () => {
    expect(newProjectPath('C:\\dev\\', 'TKN')).toBe('C:\\dev\\TKN');
  });

  it('is empty until both halves exist, so nothing is created from a guess', () => {
    expect(newProjectPath('', 'TKN')).toBe('');
    expect(newProjectPath('C:\\dev', '  ')).toBe('');
  });
});

describe('credentialReference — the shape the store demands', () => {
  it('builds the five-part reference the credential store requires', () => {
    expect(credentialReference('polygo', 'development', 'supabase', 'service-key')).toBe(
      'ProjectOS/polygo/development/supabase/service-key',
    );
  });
});

describe('the connection catalogue classifies danger, not just fields', () => {
  it('marks a Supabase service key secret and its project URL not', () => {
    const supabase = CONNECTION_CATALOGUE.find((c) => c.id === 'supabase');
    expect(supabase).toBeDefined();
    const kinds = Object.fromEntries((supabase?.fields ?? []).map((f) => [f.key, f.kind]));
    expect(kinds['service-key']).toBe('secret');
    expect(kinds['project-url']).toBe('config');
  });

  it('offers a custom connection so an unknown service is not a dead end', () => {
    expect(CONNECTION_CATALOGUE.some((c) => c.custom === true)).toBe(true);
  });

  it('every non-custom connection declares at least one field', () => {
    for (const c of CONNECTION_CATALOGUE) {
      if (c.custom !== true) expect(c.fields.length).toBeGreaterThan(0);
    }
  });
});

describe('valuesToStore — a blank is not a credential', () => {
  const rows: PendingValue[] = [
    { provider: 'supabase', key: 'project-url', label: 'Project URL', kind: 'config', value: 'https://x.supabase.co' },
    { provider: 'supabase', key: 'service-key', label: 'Service role key', kind: 'secret', value: '   ' },
    { provider: 'openai', key: 'api-key', label: 'API key', kind: 'secret', value: 'value-here' },
  ];

  it('drops blanks rather than storing an empty credential that reads as configured', () => {
    const kept = valuesToStore(rows);
    expect(kept.map((k) => k.key)).toEqual(['project-url', 'api-key']);
  });

  it('summarises a connection without ever quoting a value', () => {
    const summary = connectionSummary('supabase', rows);
    expect(summary).toContain('1 setting');
    expect(summary).not.toContain('supabase.co');
  });

  it('says plainly when nothing was entered', () => {
    expect(connectionSummary('vercel', rows)).toBe('Nothing entered');
  });

  it('counts a secret as stored securely, and never echoes it', () => {
    const summary = connectionSummary('openai', rows);
    expect(summary).toContain('1 stored securely');
    expect(summary).not.toContain('value-here');
  });
});
