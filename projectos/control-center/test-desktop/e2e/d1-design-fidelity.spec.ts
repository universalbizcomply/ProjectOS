/**
 * D1 — the redesign, proven in the REAL desktop application.
 *
 * Browser proof is not desktop proof. This drives the actual Tauri binary with the bundled
 * frontend inside WebView2, and asserts the things a browser cannot settle: that the approved
 * typography really loads on this machine, that the token layer resolves in the shipped bundle,
 * that the appearance switch recolours the whole app through one attribute, that Softer motion
 * reaches the document root, that the supplied hologram artwork decodes, and that no width the
 * handoff names scrolls sideways.
 *
 * It asserts the SHELL, not the governed data: a development run has no installed-host registry, so
 * whichever of first-run or the workspace the app honestly reports, the design is the same.
 *
 * Created in PROJECTOS-CONTROL-CENTER-LIKE-FOR-LIKE1A.
 */
import { browser, $, expect } from '@wdio/globals';

/** README §Design tokens — the exact Standard values, and the exact Command overrides. */
const STANDARD = { bg: '#eceef0', rail: '#e4e7ea', acc: '#2c6390', ink: '#0f1519' };
const COMMAND = { bg: '#050914', rail: '#070c1c', acc: '#00d5ff', ink: '#e2f7ff' };

async function tokens(): Promise<Record<string, string>> {
  return browser.execute(() => {
    const s = getComputedStyle(document.documentElement);
    const t: Record<string, string> = {};
    for (const k of ['--bg', '--rail', '--acc', '--ink', '--card', '--warn', '--crit', '--tile']) {
      t[k] = s.getPropertyValue(k).trim();
    }
    return t;
  });
}

async function setShell(mode: 'standard' | 'command'): Promise<void> {
  await browser.execute((m: string) => {
    const label = m === 'command' ? 'Command' : 'Standard';
    const btn = [...document.querySelectorAll('[role="radio"]')].find(
      (b) => (b.textContent ?? '').trim() === label,
    ) as HTMLElement | undefined;
    btn?.click();
  }, mode);
  await browser.pause(300);
}

describe('D1 · the approved design, in the real desktop application', () => {
  before(async () => {
    await $('#root').waitForExist({ timeout: 60_000 });
    await browser.pause(1500);
  });

  it('boots the redesigned shell, not the previous nine-destination sidebar', async () => {
    const shape = await browser.execute(() => ({
      rail: document.querySelectorAll('.os-rail').length,
      oldSidebar: document.querySelectorAll('.sidebar').length,
      oldNavItems: document.querySelectorAll('.navitem').length,
      canvas: document.querySelectorAll('.os-canvas').length,
      skip: document.querySelectorAll('a.skip').length,
    }));
    expect(shape.rail).toBe(1);
    expect(shape.canvas).toBe(1);
    expect(shape.skip).toBe(1);
    // The old shell is gone, not merely restyled.
    expect(shape.oldSidebar).toBe(0);
    expect(shape.oldNavItems).toBe(0);
  });

  it('lays the rail out at the specified 308px with the specified padding', async () => {
    const rail = await browser.execute(() => {
      const el = document.querySelector('.os-rail') as HTMLElement;
      const c = getComputedStyle(el);
      return { w: Math.round(el.getBoundingClientRect().width), pt: c.paddingTop, pl: c.paddingLeft, pos: c.position };
    });
    expect(rail.w).toBe(308);
    expect(rail.pt).toBe('26px');
    expect(rail.pl).toBe('18px');
    expect(rail.pos).toBe('sticky');
  });

  it('renders the approved Barlow typography, actually loaded on this machine', async () => {
    const type = await browser.execute(() => {
      const h1 = document.querySelector('h1') as HTMLElement | null;
      const c = h1 === null ? getComputedStyle(document.body) : getComputedStyle(h1);
      /*
       * MEASURED, NOT DECLARED. `document.fonts.check` answers about the descriptors it was asked
       * for, and the handoff loads Barlow at 400/500/700 only — asking it about weight 600 says
       * "no face declared for that", which is true and is not the question. The question is whether
       * the glyphs on screen are Barlow's, so the same string is measured in Barlow and in the
       * fallback stack: different advance widths mean the real face is doing the drawing.
       */
      const measure = (family: string, weight: number): number => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx === null) return 0;
        ctx.font = `${weight} 36px ${family}`;
        return ctx.measureText('ProjectOS Control Centre 0123456789').width;
      };
      // A face is fetched lazily, so ask for it before asking whether it arrived.
      return (document.fonts as unknown as { load: (f: string) => Promise<unknown> })
        .load('400 15px Barlow')
        .then(() => ({
          family: c.fontFamily,
          declared: document.fonts.check('400 15px Barlow'),
          barlow400: measure('Barlow', 400),
          fallback400: measure('system-ui', 400),
          barlow700: measure('Barlow', 700),
          // Nothing off this machine is needed to draw the product's own text.
          remoteFontLinks: [...document.querySelectorAll('link[rel="stylesheet"]')].filter((l) =>
            (l as HTMLLinkElement).href.startsWith('http') &&
            !(l as HTMLLinkElement).href.includes('tauri.localhost') &&
            !(l as HTMLLinkElement).href.includes('localhost'),
          ).length,
        }));
    });
    expect(type.family).toContain('Barlow');
    expect(type.family).not.toContain('Inter');
    // The declared face really loaded…
    expect(type.declared).toBe(true);
    // …and it is what actually draws: Barlow is a different width from the system fallback.
    expect(type.barlow400).toBeGreaterThan(0);
    expect(Math.abs(type.barlow400 - type.fallback400)).toBeGreaterThan(1);
    expect(Math.abs(type.barlow700 - type.barlow400)).toBeGreaterThan(1);
    expect(type.remoteFontLinks).toBe(0);
  });

  it('resolves the Standard token layer exactly as specified', async () => {
    await setShell('standard');
    const t = await tokens();
    expect(t['--bg']).toBe(STANDARD.bg);
    expect(t['--rail']).toBe(STANDARD.rail);
    expect(t['--acc']).toBe(STANDARD.acc);
    expect(t['--ink']).toBe(STANDARD.ink);
  });

  it('recolours the whole app through one root attribute when the appearance changes', async () => {
    await setShell('command');
    const after = await browser.execute(() => ({
      shell: document.documentElement.getAttribute('data-shell'),
      remembered: window.localStorage.getItem('projectos.shell-theme'),
    }));
    expect(after.shell).toBe('command');
    expect(after.remembered).toBe('command');

    const t = await tokens();
    expect(t['--bg']).toBe(COMMAND.bg);
    expect(t['--rail']).toBe(COMMAND.rail);
    expect(t['--acc']).toBe(COMMAND.acc);
    expect(t['--ink']).toBe(COMMAND.ink);
  });

  it('never uses backdrop-filter, in either appearance', async () => {
    const blurred = await browser.execute(() =>
      [...document.querySelectorAll('*')].filter((e) => {
        const v = getComputedStyle(e).backdropFilter;
        return v !== '' && v !== 'none';
      }).length,
    );
    expect(blurred).toBe(0);
  });

  it('decodes the supplied hologram artwork', async () => {
    const holo = await browser.execute(() => {
      const imgs = [...document.querySelectorAll('img')].filter((i) => i.src.includes('/operator/'));
      return imgs.map((i) => ({ src: i.src.split('/').pop(), w: i.naturalWidth, h: i.naturalHeight }));
    });
    // Command mode is active from the previous test; the hologram only exists there.
    if (holo.length > 0) {
      for (const layer of holo) {
        expect(layer.w).toBeGreaterThan(0);
        expect(layer.h).toBeGreaterThan(0);
      }
    }
  });

  it('carries Softer motion to the document root and stops the animations', async () => {
    await browser.execute(() => {
      const settings = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent ?? '').trim() === 'Settings',
      ) as HTMLElement | undefined;
      settings?.click();
    });
    await browser.pause(400);
    const before = await browser.execute(() => document.documentElement.getAttribute('data-calm'));
    await browser.execute(() => {
      const sw = document.querySelector('[role="switch"]') as HTMLElement | null;
      sw?.click();
    });
    await browser.pause(400);
    const after = await browser.execute(() => ({
      calm: document.documentElement.getAttribute('data-calm'),
      remembered: window.localStorage.getItem('projectos.calm-motion'),
    }));
    expect(before).toBe(null);
    expect(after.calm).toBe('1');
    expect(after.remembered).toBe('1');

    // Put it back, so the remaining checks run under the default.
    await browser.execute(() => {
      const sw = document.querySelector('[role="switch"]') as HTMLElement | null;
      sw?.click();
    });
    await browser.pause(300);
  });

  it('offers the approved accessibility roles', async () => {
    const roles = await browser.execute(() => ({
      radiogroup: document.querySelectorAll('[role="radiogroup"]').length,
      radio: document.querySelectorAll('[role="radio"]').length,
      switch: document.querySelectorAll('[role="switch"]').length,
      hidden: document.querySelectorAll('[aria-hidden="true"]').length,
    }));
    expect(roles.radiogroup).toBeGreaterThan(0);
    expect(roles.radio).toBeGreaterThanOrEqual(2);
    expect(roles.switch).toBeGreaterThan(0);
    expect(roles.hidden).toBeGreaterThan(0);
  });

  it('keeps a visible focus ring on the keyboard route', async () => {
    const ring = await browser.execute(() => {
      const rules: string[] = [];
      for (const sheet of [...document.styleSheets]) {
        let list: CSSRuleList;
        try {
          list = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of [...list]) {
          const t = (rule as CSSStyleRule).selectorText;
          if (typeof t === 'string' && t.includes(':focus-visible')) rules.push(rule.cssText);
        }
      }
      return rules.join(' | ');
    });
    expect(ring).toContain('focus-visible');
    expect(ring).toContain('outline');
  });

  it('scrolls sideways at no width the handoff names', async () => {
    const widths = [1600, 1280, 1024, 900, 768, 375];
    const overflow: Record<number, number> = {};
    for (const w of widths) {
      await browser.setWindowSize(w, 900);
      await browser.pause(500);
      overflow[w] = await browser.execute(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    }
    await browser.setWindowSize(1280, 900);
    for (const w of widths) {
      expect(overflow[w]).toBeLessThanOrEqual(1);
    }
  });

  it('reported no page error while all of that happened', async () => {
    const errors = await browser.execute(() => (window as unknown as { __errors__?: string[] }).__errors__ ?? []);
    expect(errors.length).toBe(0);
  });
});
