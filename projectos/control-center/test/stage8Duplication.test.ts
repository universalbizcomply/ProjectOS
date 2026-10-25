/**
 * STAGE 8's DUPLICATION RULINGS, HELD BY A TEST RATHER THAN BY A MEMO.
 *
 * Two rulings were mandated, and both are the kind that quietly reverse later — a component gets
 * re-added "just under Advanced", a second write path appears next to the first because a screen
 * needed one. So they are asserted against the source itself, the same way the single-activity-feed
 * rule is.
 *
 * ── RULING 1: OWNERCHAT IS REMOVED ──────────────────────────────────────────────────────────────
 *
 * The Universal Control Center is the accepted owner conversation and command surface. OwnerChat
 * was a SECOND one, and keeping it would have been keeping:
 *
 *   · a second intent router (`ownerChatModel` + `ownerChatActions`) resolving the same sentences;
 *   · a WEAKER safety posture — its suggested action ran the governed verb on ONE click, including
 *     `run.start`, which spends real money, and `run.stop`, which force-kills a process tree. The
 *     Control Center confirms every governed verb before dispatching it;
 *   · a stale-data fallback: with no runtime it answered from the RECORDED V3 snapshot, so it
 *     described a closed programme in the present tense;
 *   · copy that had already drifted from accepted truth — it told the owner pause and stop were
 *     "the same operation" because stopping keeps its session, which Stage 4/5 established is not
 *     always true (a run stopped inside its first attempt writes no session at all).
 *
 * It was not a raw execution log, a bridge transcript or a diagnostic event stream — the three
 * things that would have made it genuinely distinct. It was a duplicate, so it is gone rather than
 * renamed into one.
 *
 * ── RULING 2: ONE CREDENTIAL MANAGEMENT HOME ────────────────────────────────────────────────────
 *
 * One `Connections` component, one native write, three projections: `manage` on Settings, `status`
 * on Health, `technical` on Advanced.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A (Stage 8).
 */
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const rel = (p: string): string => p.slice(SRC.length + 1).replace(/\\/g, '/');

describe('OwnerChat is removed, not hidden', () => {
  test('none of its three modules exist any more', () => {
    for (const gone of ['owner/OwnerChat.tsx', 'owner/ownerChatModel.ts', 'owner/ownerChatActions.ts']) {
      expect(existsSync(join(SRC, gone))).toBe(false);
    }
  });

  test('nothing in the product references it', () => {
    const referencing = FILES.filter((f) => /OwnerChat|ownerChatModel|ownerChatActions/.test(f.text)).map((f) => rel(f.path));
    expect(referencing).toEqual([]);
  });

  test('the Advanced surface list no longer offers a chat', () => {
    const app = FILES.find((f) => rel(f.path) === 'App.tsx')!;
    expect(app.text).not.toMatch(/label: 'Owner Chat'/);
    expect(app.text).not.toMatch(/which === 'chat'/);
  });

  test('exactly ONE surface resolves an owner sentence to a governed verb', () => {
    // `resolveIntent` IS the router. A second one would be a second chat, whatever it was called.
    const routers = FILES.filter((f) => /export function resolveIntent\b|matchActionIntent\b/.test(f.text)).map((f) => rel(f.path));
    expect(routers).toEqual(['ux/controlCenterModel.ts']);
  });
});

describe('there is one credential management implementation', () => {
  test('only one component in the owner UX writes a credential from a projection', () => {
    // The Add Project wizard is the deliberate exception and is named here rather than excluded
    // silently: it runs BEFORE the project exists, so there is no projection to read a reference
    // from. It calls the same native command with the same reference grammar.
    const writers = FILES.filter((f) => /invoke\('set_credential'/.test(f.text)).map((f) => rel(f.path)).sort();
    expect(writers).toEqual(['owner/AddProjectWizard.tsx', 'ux/Connections.tsx']);
  });

  test('only one component renders connection rows', () => {
    const renderers = FILES.filter((f) => /connectionStandIn\(/.test(f.text) && !f.path.endsWith('workspaceModel.ts')).map((f) => rel(f.path));
    expect(renderers).toEqual(['ux/Connections.tsx']);
  });

  test('the superseded second implementation is gone', () => {
    expect(existsSync(join(SRC, 'owner/ConnectionsTab.tsx'))).toBe(false);
  });

  test('each surface asks for its own projection, and only Settings asks to manage', () => {
    const managing = FILES.filter((f) => /mode="manage"/.test(f.text)).map((f) => rel(f.path));
    const status = FILES.filter((f) => /mode="status"/.test(f.text)).map((f) => rel(f.path));
    const technical = FILES.filter((f) => /mode="technical"/.test(f.text)).map((f) => rel(f.path));
    expect(managing).toEqual(['owner/SettingsScreen.tsx']);
    expect(status).toEqual(['ux/HealthScreen.tsx']);
    expect(technical).toEqual(['owner/ConnectionsPanel.tsx']);
  });
});

describe('project Advanced and global Advanced answer different questions', () => {
  test('the project tab no longer lists the platform-wide surfaces', () => {
    // Eight identical links inside every project was the same block repeated with no contextual
    // value. The project tab keeps its own technical evidence and offers ONE way through.
    const home = FILES.find((f) => rel(f.path) === 'ux/ProjectHome.tsx')!;
    for (const platformWide of ['Mission Control', 'Integrations', 'Safety &amp; Providers', 'Safety Gates']) {
      expect(home.text).not.toContain(`>${platformWide}<`);
    }
    expect(home.text).toContain('Open ProjectOS Advanced');
  });

  test('global Advanced states that normal work does not need it', () => {
    const app = FILES.find((f) => rel(f.path) === 'App.tsx')!;
    expect(app.text).toContain('You normally do not need this');
  });

  test('the platform identity lives in Advanced and not in Settings', () => {
    const app = FILES.find((f) => rel(f.path) === 'App.tsx')!;
    const settings = FILES.find((f) => rel(f.path) === 'owner/SettingsScreen.tsx')!;
    expect(app.text).toContain('core v{CORE_VERSION}');
    expect(settings.text).not.toContain('CORE_VERSION');
  });
});
