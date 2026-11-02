import { describe, expect, it } from 'vitest';
import { lintSkill, parseSkillFrontmatter, skillNameProblem, type SkillFile, type SkillFinding } from '../src/skills/index.js';
import { GOOD_SKILL_MD, skillMd, withFrontmatter } from './skillFixtures.js';

function lint(text: string, files: readonly SkillFile[] = []): readonly SkillFinding[] {
  const parsed = parseSkillFrontmatter(text);
  if (!parsed.ok) throw new Error(`refused: ${parsed.rule}`);
  return lintSkill({ parsed: parsed.value, files });
}
const found = (text: string, rule: string, files?: readonly SkillFile[]): SkillFinding | undefined => lint(text, files).find((finding) => finding.rule === rule);

describe('errors stop promotion', () => {
  it('a good skill has no finding at all: the positive control', () => {
    expect(lint(GOOD_SKILL_MD)).toEqual([]);
  });

  it('a name is required, in format, and within its cap', () => {
    expect(skillNameProblem(null)?.rule).toBe('name-missing');
    expect(skillNameProblem('')?.rule).toBe('name-missing');
    expect(skillNameProblem('Has Spaces')?.rule).toBe('name-format');
    expect(skillNameProblem('../up')?.rule).toBe('name-format');
    expect(skillNameProblem('-leading')?.rule).toBe('name-format');
    expect(skillNameProblem('a'.repeat(65))?.rule).toBe('name-too-long');
    expect(skillNameProblem('a'.repeat(64))).toBeNull();
  });

  it('a name that is a Windows device is refused, because the name becomes a file', () => {
    for (const name of ['con', 'prn', 'aux', 'nul', 'com1', 'lpt9']) expect(skillNameProblem(name)?.rule, name).toBe('name-reserved');
    expect(skillNameProblem('console')).toBeNull();
  });

  it('a description is required and capped', () => {
    expect(found(GOOD_SKILL_MD.replace('description: Drafts release notes from merged work.\n', ''), 'description-missing')?.weight).toBe('blocking');
    expect(found(GOOD_SKILL_MD.replace('Drafts release notes from merged work.', 'x'.repeat(1025)), 'description-too-long')?.weight).toBe('blocking');
    expect(found(GOOD_SKILL_MD.replace('Drafts release notes from merged work.', 'x'.repeat(1024)), 'description-too-long')).toBeUndefined();
  });

  it('a body is required', () => {
    expect(found('---\nname: a\ndescription: b\n---\n   \n', 'body-empty')?.weight).toBe('blocking');
  });
});

describe('warnings inform and stop nothing', () => {
  const advisory = (text: string, rule: string, files?: readonly SkillFile[]): void => {
    expect(found(text, rule, files)?.weight, rule).toBe('advisory');
  };

  it('a long or marketing description', () => {
    advisory(GOOD_SKILL_MD.replace('Drafts release notes from merged work.', 'x'.repeat(61)), 'description-length');
    advisory(GOOD_SKILL_MD.replace('Drafts release notes', 'A powerful way to draft notes'), 'description-marketing');
  });

  it('missing metadata names each key', () => {
    const bare = '---\nname: a\ndescription: b\n---\n## When to Use\n\nx\n';
    expect(lint(bare).filter((finding) => finding.rule === 'missing-metadata').map((finding) => finding.message.split("'")[1])).toEqual(['version', 'author', 'license', 'tags']);
    expect(found(bare.replace('---\n##', 'metadata:\n  tags: [a]\nversion: 1\nauthor: a\nlicense: MIT\n---\n##'), 'missing-metadata')).toBeUndefined();
  });

  it('a platform that is not one', () => {
    advisory(withFrontmatter('platforms: [linux, beos]'), 'platforms-value');
    expect(found(withFrontmatter('platforms: [linux, windows]'), 'platforms-value')).toBeUndefined();
  });

  it('a long body', () => {
    advisory(skillMd('x\n'.repeat(12_001)), 'oversized-body');
  });

  it('a shell utility in prose, and not in fenced code', () => {
    advisory(skillMd('Run `grep` here.'), 'shell-utility-reference');
    expect(found(skillMd('```\n`grep`\n```'), 'shell-utility-reference')).toBeUndefined();
    expect(found(skillMd('~~~~\n`grep`\n~~~\nstill code\n~~~~'), 'shell-utility-reference')).toBeUndefined();
    expect(found(skillMd('```\n`grep`'), 'shell-utility-reference')).toBeUndefined();
  });

  it('no When to Use section', () => {
    advisory(GOOD_SKILL_MD.replace('## When to Use', '## Other'), 'missing-section');
  });

  it('a body shaped like an incident log', () => {
    advisory(skillMd('#1234 #1235 #1236 #1237'), 'incident-log-shape');
    expect(found(skillMd('#1234 #1235'), 'incident-log-shape')).toBeUndefined();
  });

  it('a link to a file the package does not hold', () => {
    advisory(skillMd('See references/a.md.'), 'dangling-reference');
    expect(found(skillMd('See references/a.md.'), 'dangling-reference', [{ path: 'references/a.md', text: 'x' }])).toBeUndefined();
    expect(found(skillMd('See references/*.md.'), 'dangling-reference')).toBeUndefined();
  });

  it('a script with POSIX primitives and no platforms', () => {
    const script = { path: 'scripts/a.sh', text: 'apt-get install x' };
    advisory(GOOD_SKILL_MD, 'platforms-gating', [script]);
    expect(found(withFrontmatter('platforms: [linux]'), 'platforms-gating', [script])).toBeUndefined();
    expect(found(GOOD_SKILL_MD, 'platforms-gating', [{ path: 'references/a.sh', text: 'apt-get' }])).toBeUndefined();
  });

  it('a declared tool list grants nothing, and the reviewer is told so', () => {
    advisory(withFrontmatter('allowed-tools: Bash'), 'declares-tools');
  });
});
