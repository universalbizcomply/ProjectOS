/**
 * P1 — the post-V3 self-hosting pilot audit.
 *
 * This is NOT a governance proof and it closes nothing. It is an INSPECTION: it drives the real
 * desktop Control Centre and records what an owner actually sees on every surface, at every width,
 * so that findings come from the running product rather than from reading its source.
 *
 * It is deliberately read-only. The only interactions are navigation clicks and window resizes;
 * nothing is submitted, approved, created or closed. A failing assertion here is a PILOT FINDING to
 * be reported, not a regression to be silenced — so the assertions are narrow and each one states
 * the owner-facing property it is protecting.
 *
 * Created in the post-V3 self-hosting pilot (projectos-post-v3-selfhost-pilot1a).
 */

const VIEWS = [
  'Owner Control',
  'Forge',
  'Owner Chat',
  'Safety & Providers',
  'Projects',
  'Mission Control',
  'Workflow',
  'Safety Gates',
  'Integrations',
] as const;

const WIDTHS = [
  { w: 320, h: 900, label: '320 (small phone)' },
  { w: 390, h: 900, label: '390 (phone)' },
  { w: 768, h: 1024, label: '768 (tablet portrait)' },
  { w: 1280, h: 900, label: '1280 (laptop)' },
  { w: 1600, h: 1000, label: '1600 (desktop)' },
] as const;

/** Everything the audit records, printed at the end as one machine-readable block. */
const findings: Record<string, unknown> = {};

/**
 * Navigate by dispatching the click INSIDE the page rather than through WebDriver.
 *
 * Not a shortcut around the UI: it is the same DOM button and the same React handler. It exists
 * because the Tauri service runs `ensureActiveWindowFocus` before EVERY WebDriver command and that
 * probe times out after 5s in this embedded configuration, so a nav step done the long way costs
 * ~30s. Nine views at five widths would exceed any sane suite budget for no extra coverage.
 */
async function gotoView(label: string): Promise<void> {
  const clicked = await browser.execute((wanted: string) => {
    // EVERY nav landmark, not just the primary one. The workflow is now two primary destinations
    // with the remaining seven grouped as reference and support, so a helper that searched only
    // `nav[aria-label="Primary"]` would report a surface as missing when it is merely secondary —
    // a false alarm about the exact thing this audit exists to check. The label is read from the
    // label element where one exists, because a primary item also carries a hint.
    for (const nav of Array.from(document.querySelectorAll('nav'))) {
      for (const b of Array.from(nav.querySelectorAll('button'))) {
        const labelEl = b.querySelector('.navlabel');
        const text = ((labelEl ?? b).textContent ?? '').trim();
        if (text === wanted) {
          (b as HTMLButtonElement).click();
          return true;
        }
      }
    }
    return false;
  }, label);
  if (!clicked) throw new Error(`nav item not found: ${label}`);
  await browser.pause(350);
}

describe('P1 self-hosting pilot — what the owner actually sees', function () {
  // Each WebDriver round trip carries a fixed ~5s focus-probe penalty in this embedded setup (see
  // gotoView). The suite is bounded work, not a hang, so it is given a budget that fits it.
  this.timeout(900_000);

  before(async () => {
    await browser.waitUntil(async () => (await browser.getTitle()).length > 0, { timeout: 30_000 });
    await $('#root').waitForExist({ timeout: 30_000 });
    await $('nav[aria-label="Primary"]').waitForExist({ timeout: 30_000 });
  });

  it('P1a the dev-tree build reaches genuine LIVE governed state', async () => {
    // Phase-1 acceptance. The release build cannot get here at all (PackagedCandidate ->
    // ProductionIdentityUnavailable), so reaching "Live" is the whole point of building debug.
    const src = await $('[data-testid="ocp-source"]');
    await src.waitForExist({ timeout: 30_000 });
    await browser.waitUntil(async () => (await src.getText()).includes('Live'), {
      timeout: 90_000,
      timeoutMsg: 'the local worker never reported live governed state from the development tree',
    });
    const text = (await src.getText()).replace(/\s+/g, ' ');
    findings.liveSourceLine = text;
    expect(text).toContain('Live');
    expect(text).not.toContain('Not live');
    expect(text).toContain('plan 1.3');
    expect(text).toContain('PLAN READY');
    const body = await $('body').getText();
    expect(body).not.toContain('Local worker unavailable');
  });

  it('P1b the programme reads 19 / 19 at 100 with no active numbered phase', async () => {
    const meter = await $('.ocp-meter [role="progressbar"]');
    await meter.waitForExist({ timeout: 20_000 });
    const shown = Number(await meter.getAttribute('aria-valuenow'));
    findings.completionShown = shown;
    expect(shown).toBe(100);
    expect(await $('#main').getText()).toContain('19 of 19');
  });

  it('P1c records every surface: heading, controls, and whether it renders at all', async () => {
    const surfaces: Record<string, unknown> = {};
    for (const v of VIEWS) {
      await gotoView(v);
      // One round trip per surface: heading, size, controls and excerpt collected together.
      const snap = await browser.execute(() => {
        const root = document.querySelector('#main');
        if (root === null) return { heading: '(no #main)', chars: 0, controls: [], excerpt: '' };
        const text = (root.textContent ?? '').replace(/\s+/g, ' ').trim();
        const h1 = root.querySelector('h1');
        const controls = Array.from(
          root.querySelectorAll('button, a[href], input, select, textarea, [role="button"]'),
        ).map((el) => ({
          label: ((el.textContent ?? '') ||
            (el as HTMLInputElement).placeholder ||
            el.getAttribute('aria-label') ||
            '')
            .trim()
            .slice(0, 60),
          enabled: !(el as HTMLButtonElement).disabled,
          tag: el.tagName.toLowerCase(),
        }));
        return {
          heading: h1 === null ? '(no h1)' : (h1.textContent ?? '').trim(),
          chars: text.length,
          controls,
          excerpt: text.slice(0, 500),
        };
      });
      surfaces[v] = snap;
      expect(snap.chars).toBeGreaterThan(0); // an empty surface is a defect, not a design
    }
    findings.surfaces = surfaces;
  });

  it('P1d the home screen presents no fabricated production approval', async () => {
    await gotoView('Owner Control');
    const seen = await browser.execute(() => {
      // `textContent` and `querySelectorAll` both see INSIDE a closed <details>: the content stays
      // in the DOM and is only hidden from rendering. Measuring those would report the fixture as
      // "still present" no matter how well it is put away, so what is measured is what the owner
      // can actually SEE — an element with no layout box is not on the screen.
      // `offsetParent` alone is not enough. Chromium hides closed-<details> content with
      // `content-visibility`, which skips painting the subtree while still giving descendants a
      // layout box — so an h2 inside a closed disclosure reported as "visible" on the first run.
      // Being inside a closed <details> is checked directly, which is also exactly what is meant.
      const isVisible = (el: Element): boolean =>
        el.closest('details:not([open])') === null && (el as HTMLElement).offsetParent !== null;
      const visibleHeadings = Array.from(document.querySelectorAll('#main h2'))
        .filter(isVisible)
        .map((h) => (h.textContent ?? '').trim());
      const migrationVisible = Array.from(document.querySelectorAll('#main *')).some(
        (el) => isVisible(el) && (el.textContent ?? '').includes('Apply a database migration') && el.children.length === 0,
      );
      return {
        visibleHeadings,
        migrationVisible,
        detailsOpen: Array.from(document.querySelectorAll('#main details')).map((d) => (d as HTMLDetailsElement).open),
        summaryLabel: (document.querySelector('#main details summary')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      };
    });
    findings.syntheticOnHome = seen;
    // The fixture may still EXIST behind explicit owner intent; what it may not do is present
    // itself, unasked, as a pending production decision.
    expect(seen.visibleHeadings).not.toContain('ProjectOS needs your approval');
    expect(seen.migrationVisible).toBe(false);
    expect(seen.detailsOpen.every((o) => o === false)).toBe(true);
    // And it must say what it is before it can be opened.
    expect(seen.summaryLabel).toContain('Example only');
  });

  it('P1d2 a completed programme is told it is complete, not blocked by a phantom dependency', async () => {
    await gotoView('Owner Control');
    const next = await browser.execute(
      () => (document.querySelector('.ocp-next')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    findings.nextSafeAction = next;
    expect(next).toContain('Every phase in the approved plan is complete');
    expect(next).not.toContain('unmet dependency');
  });

  it('P1e responsive: no horizontal overflow and nav stays reachable at every width', async () => {
    const results: Record<string, unknown> = {};
    for (const { w, h, label } of WIDTHS) {
      await browser.setWindowSize(w, h);
      await browser.pause(500);
      const perView: Record<string, unknown> = {};
      for (const v of VIEWS) {
        let navReachable = true;
        try {
          await gotoView(v);
        } catch {
          navReachable = false;
        }
        const m = await browser.execute(() => ({
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
          bodyScrollW: document.body.scrollWidth,
        }));
        perView[v] = {
          navReachable,
          overflowPx: Math.max(0, m.scrollW - m.clientW),
          bodyOverflowPx: Math.max(0, m.bodyScrollW - m.clientW),
        };
      }
      results[label] = perView;
    }
    findings.responsive = results;
    await browser.setWindowSize(1400, 950);

    // Assert, do not merely collect. Without this the test passed whatever the numbers were, which
    // makes a green run mean nothing — the property is checked here, per width and per surface, so
    // a future layout regression fails loudly and names the exact screen.
    const offenders: string[] = [];
    for (const [width, views] of Object.entries(results)) {
      for (const [view, m] of Object.entries(views as Record<string, { navReachable: boolean; overflowPx: number; bodyOverflowPx: number }>)) {
        if (!m.navReachable) offenders.push(`${width} / ${view}: primary navigation unreachable`);
        if (m.overflowPx > 0) offenders.push(`${width} / ${view}: ${m.overflowPx}px horizontal overflow`);
        if (m.bodyOverflowPx > 0) offenders.push(`${width} / ${view}: ${m.bodyOverflowPx}px body overflow`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('P1f accessibility basics on the owner home screen', async () => {
    await browser.setWindowSize(1400, 950);
    await gotoView('Owner Control');
    const a11y = await browser.execute(() => {
      const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map((h) => ({
        level: Number(h.tagName[1]),
        text: (h.textContent ?? '').trim().slice(0, 60),
      }));
      const unlabelled = Array.from(document.querySelectorAll('button')).filter(
        (b) => (b.textContent ?? '').trim() === '' && b.getAttribute('aria-label') === null,
      ).length;
      const inputsNoLabel = Array.from(document.querySelectorAll('input,select,textarea')).filter((el) => {
        const id = el.getAttribute('id');
        const labelled =
          el.getAttribute('aria-label') !== null ||
          el.getAttribute('aria-labelledby') !== null ||
          (id !== null && document.querySelector(`label[for="${id}"]`) !== null);
        return !labelled;
      }).length;
      return {
        h1Count: document.querySelectorAll('h1').length,
        headings,
        unlabelledButtons: unlabelled,
        unlabelledInputs: inputsNoLabel,
        hasSkipLink: document.querySelector('a.skip') !== null,
        mainLandmark: document.querySelectorAll('main').length,
        navLandmark: document.querySelectorAll('nav[aria-label]').length,
      };
    });
    findings.a11y = a11y;
    expect(a11y.hasSkipLink).toBe(true);
    expect(a11y.mainLandmark).toBe(1);
    expect(a11y.navLandmark).toBeGreaterThan(0);
  });

  it('P1g keyboard: the owner workflow is reachable by keyboard', async () => {
    await gotoView('Owner Control');

    // HARNESS LIMITATION, stated rather than worked around: synthetic `Tab` through this embedded
    // WebDriver session does not move focus in the WebView — two attempts (unseeded, and seeded via
    // .focus() on the skip link) both left activeElement where it started. That is a property of
    // the test transport, NOT evidence about the application, so no claim is made from it.
    //
    // What IS measurable here is the structure real keyboard traversal depends on: that focusable
    // stops exist, in document order, starting with the skip link and reaching the primary nav,
    // with nothing removed from the tab ring. A genuine end-to-end keyboard walk needs a human or a
    // transport that delivers real key events, and is recorded as outstanding.
    const kb = await browser.execute(() => {
      const focusable = Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.closest('details:not([open])') === null);
      const canFocus = (el: HTMLElement): boolean => {
        el.focus();
        return document.activeElement === el;
      };
      return {
        count: focusable.length,
        firstThree: focusable.slice(0, 3).map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? '').trim().slice(0, 30),
        })),
        negativeTabIndex: focusable.filter((el) => el.getAttribute('tabindex') === '-1').length,
        firstIsProgrammaticallyFocusable: focusable[0] !== undefined && canFocus(focusable[0]),
        // EVERY nav landmark. Grouping seven destinations as reference must not quietly make them
        // mouse-only — demoting a surface is a presentation decision, not permission to drop it out
        // of the keyboard path.
        navButtonsFocusable: Array.from(
          document.querySelectorAll<HTMLElement>('nav button'),
        ).every(canFocus),
      };
    });
    findings.keyboard = kb;
    expect(kb.count).toBeGreaterThan(5);
    expect(kb.firstThree[0]?.text).toContain('Skip to content');
    expect(kb.firstIsProgrammaticallyFocusable).toBe(true);
    // Every primary-navigation destination must be reachable, or the app is mouse-only.
    expect(kb.navButtonsFocusable).toBe(true);
    expect(kb.negativeTabIndex).toBe(0);
  });

  after(() => {
    console.log('\n===P1_FINDINGS_JSON_START===');
    console.log(JSON.stringify(findings));
    console.log('===P1_FINDINGS_JSON_END===\n');
  });
});
