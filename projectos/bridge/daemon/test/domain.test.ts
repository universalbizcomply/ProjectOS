import { describe, test, expect } from 'vitest';
import { diffGit } from '../src/git/gitWatcher.js';
import { readValidatorMarker } from '../src/validators/validatorWatcher.js';
import { reportSignals, newEntries } from '../src/reports/reportWatcher.js';
import { parseApproval, approvalEventType } from '../src/reports/approvalWatcher.js';

describe('gitWatcher.diffGit', () => {
  test('null next → no signals', () => {
    expect(diffGit(null, null).committed).toBe(false);
  });
  test('null prev → baseline, dirty reflected', () => {
    const s = diffGit(null, { branch: 'main', head: 'a', dirtyCount: 2 });
    expect(s.filesChanged).toBe(true);
    expect(s.committed).toBe(false);
    expect(s.head).toBe('a');
  });
  test('head change → committed; branch + dirty change detected', () => {
    const s = diffGit(
      { branch: 'main', head: 'a', dirtyCount: 0 },
      { branch: 'dev', head: 'b', dirtyCount: 1 },
    );
    expect(s.committed).toBe(true);
    expect(s.branchChanged).toBe(true);
    expect(s.filesChanged).toBe(true);
  });
  test('empty new head is not a commit', () => {
    const s = diffGit({ branch: 'm', head: 'a', dirtyCount: 0 }, { branch: 'm', head: '', dirtyCount: 0 });
    expect(s.committed).toBe(false);
  });
});

describe('validatorWatcher.readValidatorMarker', () => {
  test('null/blank/invalid → unknown', () => {
    expect(readValidatorMarker(null).state).toBe('unknown');
    expect(readValidatorMarker('  ').state).toBe('unknown');
    expect(readValidatorMarker('{bad').state).toBe('unknown');
    expect(readValidatorMarker('42').state).toBe('unknown');
  });
  test('status running/pass/fail and result shape', () => {
    expect(readValidatorMarker('{"status":"running"}')).toEqual({ state: 'running', completed: false });
    expect(readValidatorMarker('{"status":"pass"}').completed).toBe(true);
    expect(readValidatorMarker('{"result":"fail"}').state).toBe('fail');
    expect(readValidatorMarker('{"other":1}').state).toBe('unknown');
  });
});

describe('reportWatcher', () => {
  test('newEntries diff', () => {
    expect(newEntries(['a'], ['a', 'b'])).toEqual(['b']);
  });
  test('report + evidence signals; REVIEW_READY when both present and new', () => {
    const r = reportSignals([], ['r.md'], [], ['e.json']);
    expect(r.signals).toContain('REPORT_CREATED');
    expect(r.signals).toContain('EVIDENCE_CREATED');
    expect(r.signals).toContain('REVIEW_READY');
  });
  test('no REVIEW_READY without both', () => {
    const r = reportSignals([], ['r.md'], [], []);
    expect(r.signals).toEqual(['REPORT_CREATED']);
  });
  test('no signals when nothing new', () => {
    expect(reportSignals(['r.md'], ['r.md'], ['e.json'], ['e.json']).signals).toEqual([]);
  });
});

describe('approvalWatcher', () => {
  test('approvalEventType maps decisions', () => {
    expect(approvalEventType('approved')).toBe('OWNER_APPROVED');
    expect(approvalEventType('rejected')).toBe('OWNER_REJECTED');
    expect(approvalEventType('changes')).toBe('CHANGES_REQUESTED');
    expect(approvalEventType('commit')).toBe('COMMIT_APPROVED');
    expect(approvalEventType('push')).toBe('PUSH_APPROVED');
    expect(approvalEventType('close')).toBe('PHASE_CLOSED');
    expect(approvalEventType('bogus')).toBeNull();
  });

  test('parseApproval honours owner-only and valid decision', () => {
    expect(parseApproval('{"decision":"approved","decidedBy":"owner"}')?.type).toBe('OWNER_APPROVED');
    expect(parseApproval('{"decision":"approved"}')?.type).toBe('OWNER_APPROVED');
  });

  test('parseApproval rejects non-owner, malformed, unknown decision', () => {
    expect(parseApproval('{"decision":"approved","decidedBy":"chatgpt"}')).toBeNull();
    expect(parseApproval(null)).toBeNull();
    expect(parseApproval('  ')).toBeNull();
    expect(parseApproval('{bad')).toBeNull();
    expect(parseApproval('42')).toBeNull();
    expect(parseApproval('{"decision":123}')).toBeNull();
    expect(parseApproval('{"decision":"nope"}')).toBeNull();
  });
});
