// @vitest-environment jsdom
/**
 * FORGE'S SCREEN DESCRIBES WHAT IS ACTUALLY THERE.
 *
 * It used to run a deterministic synthetic demo — "A Booking App", twelve files, a 42,000-token
 * budget, four passing checks, two snapshots — none of which had happened. The engines it depicted
 * are real, but nothing on the screen ever called them, so the surface an owner would judge Forge by
 * was showing invented work as work.
 *
 * These tests hold the replacement to the only standard that matters: every stage it names must
 * exist on disk, with the validator it claims, and it must not display a run.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORGE_STAGES, ForgeConsole } from '../src/forge/ForgeConsole';

afterEach(() => cleanup());

const REPO = resolve(__dirname, '../../..');

describe('every stage the screen names is real', () => {
  test('each names a module that exists in projectos/forge', () => {
    expect(FORGE_STAGES.length).toBeGreaterThan(0);
    for (const s of FORGE_STAGES) {
      const p = resolve(REPO, 'projectos/forge', s.module);
      expect(existsSync(p), `${s.id}: ${s.module} does not exist`).toBe(true);
    }
  });

  test('each names a validator that exists', () => {
    for (const s of FORGE_STAGES) {
      const p = resolve(REPO, 'projectos/validators', `${s.validator}.cjs`);
      expect(existsSync(p), `${s.id}: ${s.validator} does not exist`).toBe(true);
    }
  });

  test('the stages are distinct, and none is listed twice', () => {
    const ids = FORGE_STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const modules = FORGE_STAGES.map((s) => s.module);
    expect(new Set(modules).size).toBe(modules.length);
  });

  test('the actions that reach the real world are marked as the owner\'s', () => {
    const gated = FORGE_STAGES.filter((s) => s.ownerGated).map((s) => s.id);
    for (const id of ['provision', 'deploy']) {
      expect(gated, `${id} must need the owner`).toContain(id);
    }
    // And planning-only stages must NOT be marked as needing approval, or the marking means nothing.
    for (const id of ['blueprint', 'scaffold']) {
      expect(gated).not.toContain(id);
    }
  });
});

describe('the screen shows no run, because there has been none', () => {
  test('nothing from the old demo is displayed', () => {
    render(<ForgeConsole />);
    const shown = document.body.textContent ?? '';
    for (const ghost of ['A Booking App', 'An Online Store', 'snap_a1', 'booking feature', '42,000', '100,000']) {
      expect(shown, `the screen still displays "${ghost}"`).not.toContain(ghost);
    }
  });

  test('it says plainly that nothing here starts a build', () => {
    render(<ForgeConsole />);
    expect(document.body.textContent ?? '').toContain('nothing here starts a Forge build');
  });

  test('it displays no progress bar, budget or pass count', () => {
    const { container } = render(<ForgeConsole />);
    const shown = document.body.textContent ?? '';
    // A number presented as a measurement is what made the old screen dishonest.
    expect(shown).not.toMatch(/\d+\s*%/);
    expect(shown).not.toMatch(/\d+\s*\/\s*\d{3,}/);
    expect(container.querySelector('progress')).toBeNull();
    expect(container.querySelector('.fg-bar, .fg-budget')).toBeNull();
  });

  test('every stage it lists is on the screen, with the owner-gated ones marked', () => {
    render(<ForgeConsole />);
    const shown = document.body.textContent ?? '';
    for (const s of FORGE_STAGES) expect(shown).toContain(s.title);
    expect(shown).toContain('needs your approval');
  });
});
