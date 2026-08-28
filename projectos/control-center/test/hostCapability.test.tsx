// @vitest-environment jsdom
/**
 * A HOSTED PAGE MUST NOT DESCRIBE ITSELF AS A RUNTIME THAT HAS STOPPED.
 *
 * Integration exposed this, and only hosting could have. Every governed capability travels the
 * native bridge to a local host: the projection, all sixteen verbs, the credential write, the
 * worker. A browser build correctly gets `NullTransport`, and Health, the Control Center and
 * Connections all reported the result truthfully — "the runtime is not answering", "no project is
 * reporting yet", "needs the installed ProjectOS desktop application".
 *
 * The one thing none of them said was WHY, and the difference is the difference between waiting and
 * knowing:
 *
 *   · on the desktop, "the runtime is not answering" describes a host that exists and has stopped.
 *     Starting it fixes the problem, so waiting is the right thing to do.
 *   · in a browser, nothing about the page will ever reach a computer. The same sentence then
 *     describes a temporary outage that will never end, and an owner waits for something that
 *     cannot arrive.
 *
 * The sharpest form of it was the Projects screen: "Reading the list of projects on this computer…"
 * — a pending line, rendered forever, for a read that was never going to happen.
 *
 * These prove the corrected contract from a RENDERED tree, in both directions: the explanation
 * appears without a host, and is completely absent with one.
 *
 * Created in PROJECTOS-CONTROL-CENTER-INTEGRATION1A.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NoLocalHostNotice, hasLocalHost } from '../src/ux/HostCapability';
import { ProjectsScreen } from '../src/ux/ProjectsScreen';
import { buildProjectsModel } from '../src/ux/projectsModel';
import { tauriBridge } from '../src/daemon/tauriBridge';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const host = (present: boolean) => vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(present);

/** The state a browser is permanently in: no inventory, no projection, and none coming. */
const unknownModel = () => buildProjectsModel(null, null, Date.now());

describe('the capability question is asked in one place', () => {
  test('hasLocalHost follows the bridge, and nothing else', () => {
    host(true);
    expect(hasLocalHost()).toBe(true);
    vi.restoreAllMocks();
    host(false);
    expect(hasLocalHost()).toBe(false);
  });
});

describe('without a local host the page explains itself', () => {
  test('it says it is a browser, and that projects live on the owner’s computer', () => {
    host(false);
    render(<NoLocalHostNotice />);
    expect(screen.getByText(/looking at ProjectOS in a web browser/i)).toBeTruthy();
    expect(screen.getByRole('note').textContent ?? '').toMatch(/runs your projects on your own computer/i);
  });

  test('it names what cannot be done here rather than leaving the owner to discover it', () => {
    host(false);
    const { container } = render(<NoLocalHostNotice />);
    const text = container.textContent ?? '';
    for (const capability of [/list your projects/i, /open a plan/i, /start or stop work/i, /store a key/i]) {
      expect(text).toMatch(capability);
    }
  });

  test('it does not blame a fault — nothing here is broken', () => {
    host(false);
    const { container } = render(<NoLocalHostNotice />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/not because something is broken/i);
    // A `note`, not an `alert`. Opening a link is not an emergency.
    expect(screen.getByRole('note')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBe(null);
  });

  test('it tells the owner what to do instead', () => {
    host(false);
    render(<NoLocalHostNotice />);
    expect(screen.getByRole('note').textContent ?? '').toMatch(/open the ProjectOS application/i);
  });
});

describe('with a local host it is not there at all', () => {
  test('the installed application renders nothing of it — not a hidden node, nothing', () => {
    host(true);
    const { container } = render(<NoLocalHostNotice />);
    expect(container.innerHTML).toBe('');
  });
});

describe('the Projects screen stops promising a read that cannot happen', () => {
  test('with a host, a pending inventory still reads as work in progress', () => {
    host(true);
    render(<ProjectsScreen model={unknownModel()} onOpen={() => {}} onAddProject={() => {}} />);
    expect(screen.getByText(/Reading the list of projects on this computer/i)).toBeTruthy();
  });

  test('without a host it says the projects are elsewhere, and never says "Reading…"', () => {
    host(false);
    const { container } = render(<ProjectsScreen model={unknownModel()} onOpen={() => {}} onAddProject={() => {}} />);
    expect(container.textContent ?? '').not.toMatch(/Reading the list of projects/i);
    expect(screen.getByText(/cannot reach them/i)).toBeTruthy();
    expect(screen.getByText(/Open the ProjectOS application/i)).toBeTruthy();
  });

  test('the screen itself is otherwise unchanged — this is a sentence, not a redesign', () => {
    host(false);
    render(<ProjectsScreen model={unknownModel()} onOpen={() => {}} onAddProject={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add project' })).toBeTruthy();
  });
});
