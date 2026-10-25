// @vitest-environment jsdom
/**
 * ONE PLACE CHOOSES THE PROJECT; EVERY OTHER PLACE STATES IT.
 *
 * Owner Chat and Safety & Providers each used to carry their own `<select aria-label="Select
 * project">` over a static fixture list — `OWNER_MODELS` and `GOVERNED_CHAINS` respectively. Neither
 * list is the set of projects this installation may actually govern, so three controls shared one
 * label and backed onto three different answers, and two of them could point a page at a project
 * this ProjectOS has never heard of.
 *
 * These tests pin the outcome the owner decided: exactly ONE surface holds an interactive selector,
 * the other two surfaces display the authoritative selection read-only, and nothing on those pages
 * can override, shadow or locally retain a different one.
 *
 * STAGE 8 NOTE. Owner Chat was REMOVED — the Universal Control Center is the owner's one
 * conversation and command surface, and a second chat behind Advanced duplicated it with a weaker
 * safety posture (see `stage8Duplication.test.ts`). Its rows are deleted from these tables rather
 * than left pointing at nothing. Every invariant below is unchanged and still proven on the
 * surfaces that remain: Safety & Providers displays the authoritative selection read-only, Owner
 * Control holds the ONE interactive selector, and mounting them together yields exactly one control.
 *
 * Created in PROJECTOS-PHASE6-SECTION-C.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { DaemonProvider } from '../src/daemon/DaemonProvider.js';
import { DaemonClient } from '../src/daemon/daemonClient.js';
import { SafetyProviders } from '../src/owner/SafetyProviders.js';
import { OwnerControlPlane } from '../src/owner/OwnerControlPlane.js';
import { createFakeScheduler, createFakeTransport } from './helpers.js';

afterEach(cleanup);

const INVENTORY = {
  kind: 'governed-projects' as const,
  inventory: {
    projects: [
      {
        projectId: 'projectos',
        projectName: 'ProjectOS',
        repositoryRoot: 'C:\\dev\\ProjectOS',
        repository: 'universalbizcomply/ProjectOS',
      },
      {
        projectId: 'dead-aisle',
        projectName: 'Dead Aisle',
        repositoryRoot: 'C:\\dev\\DeadAisle',
        repository: 'murad/dead-aisle',
      },
    ],
    registryStatus: 'ok',
    refusedCount: 0,
    selectedProjectId: 'dead-aisle',
  },
};

function mount(node: React.ReactElement) {
  const transport = createFakeTransport();
  const client = new DaemonClient(transport, createFakeScheduler());
  render(<DaemonProvider client={client}>{node}</DaemonProvider>);
  client.start();
  return { transport };
}

function withInventory(node: React.ReactElement) {
  const { transport } = mount(node);
  act(() => transport.emit(INVENTORY));
  return { transport };
}

describe('[12, 13] the fixture project selectors are gone', () => {
  test('Safety & Providers has no project selector', () => {
    withInventory(<SafetyProviders />);
    expect(screen.queryByLabelText('Select project')).toBeNull();
    expect(screen.queryByTestId('project-select')).toBeNull();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });
});

describe('[14] both pages show the authoritative selected project', () => {
  test.each([
    ['Safety & Providers', <SafetyProviders key="safety" />],
  ])('%s names the selected project and its repository', (_name, node) => {
    withInventory(node);
    const identity = screen.getByTestId('selected-project-identity');
    expect(identity.textContent).toContain('Dead Aisle');
    expect(screen.getByTestId('selected-project-identity-repo').textContent).toBe('murad/dead-aisle');
  });

  /**
   * THREE STATES, NEVER TWO. "Not reported yet" is not "nothing chosen", and neither is "nothing
   * available to choose". Each has its own sentence and its own next step for the owner.
   */
  test.each([
    ['Safety & Providers', <SafetyProviders key="safety" />],
  ])('%s says it is still checking before the runtime reports', (_name, node) => {
    mount(node);
    expect(screen.getByTestId('selected-project-identity-pending').textContent).toContain(
      'Checking which project is selected',
    );
    expect(screen.queryByTestId('selected-project-identity-none')).toBeNull();
  });

  test.each([
    ['Safety & Providers', <SafetyProviders key="safety" />],
  ])('%s says so plainly when projects exist but none is chosen', (_name, node) => {
    const { transport } = mount(node);
    act(() =>
      transport.emit({
        ...INVENTORY,
        inventory: { ...INVENTORY.inventory, selectedProjectId: null },
      }),
    );
    const none = screen.getByTestId('selected-project-identity-none');
    expect(none.textContent).toContain('No project chosen yet');
    // And it points at the one place that CAN choose, rather than leaving the owner stuck.
    //
    // RETARGETED, NOT RELAXED. This asserted the words "Owner Control", which
    // PROJECTOS-CONTROL-CENTER-INTEGRATION1A retired as a second owner workflow. The invariant is
    // unchanged and just as strong — the empty state must NAME the surface that can actually choose
    // — but the surface that can is Projects now. Left as it was, the test would have demanded that
    // the product keep directing owners to a page that no longer exists.
    expect(none.textContent).toContain('Projects');
  });

  test.each([
    ['Safety & Providers', <SafetyProviders key="safety" />],
  ])('%s does not send the owner somewhere to choose from an empty list', (_name, node) => {
    const { transport } = mount(node);
    act(() =>
      transport.emit({
        ...INVENTORY,
        inventory: { ...INVENTORY.inventory, projects: [], selectedProjectId: null },
      }),
    );
    const none = screen.getByTestId('selected-project-identity-none');
    expect(none.textContent).toContain('No project is available');
    expect(none.textContent).not.toContain('Choose one');
  });

  /**
   * A project outside the shipped fixtures must not silently borrow ProjectOS's recorded position.
   * `dead-aisle` is exactly such an id: the snapshot models and governed chains know only
   * `projectos` and `acme-app`.
   */
  test('Safety & Providers shows no borrowed approval chain for an unknown project', () => {
    withInventory(<SafetyProviders />);
    expect(screen.queryByTestId('sp-no-chain')).not.toBeNull();
  });

  test('Owner Control says there is no recorded position for an unknown project', () => {
    withInventory(<OwnerControlPlane />);
    expect(screen.queryByTestId('ocp-no-recorded-position')).not.toBeNull();
  });
});

describe('[15] neither page can override the selected project', () => {
  test.each([
    ['Safety & Providers', <SafetyProviders key="safety" />],
  ])('%s follows the authoritative selection when it changes, and offers no way to change it', (_name, node) => {
    const { transport } = withInventory(node);
    expect(screen.getByTestId('selected-project-identity').textContent).toContain('Dead Aisle');

    act(() =>
      transport.emit({
        ...INVENTORY,
        inventory: { ...INVENTORY.inventory, selectedProjectId: 'projectos' },
      }),
    );
    expect(screen.getByTestId('selected-project-identity').textContent).toContain('ProjectOS');

    // There is no control here at all — not a disabled one, not a hidden one.
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /project/i })).toHaveLength(0);
  });

  /**
   * The stronger form of the same property: the SOURCE. Neither page holds a project in local state,
   * so there is nothing for a page to retain across a change of selection — the identity it shows is
   * always the one the inventory reports.
   */
  test.each([
    ['SafetyProviders.tsx', 'src/owner/SafetyProviders.tsx'],
  ])('%s retains no project of its own', async (_name, path) => {
    const source = await import('node:fs').then((fs) => fs.readFileSync(path, 'utf8'));
    expect(source).not.toContain('setProjectId');
    expect(source).not.toContain('useState<string>(PROJECTOS_V3.projectId)');
    expect(source).not.toMatch(/aria-label="Select project"/);
  });
});

describe('[16] Owner Control holds the only interactive project selector', () => {
  test('the selector is on Owner Control and submits a project id', () => {
    withInventory(<OwnerControlPlane />);
    const select = screen.getByTestId('project-select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    // Its options are project IDS — never repository paths.
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toContain('projectos');
    expect(values).toContain('dead-aisle');
    for (const value of values) {
      expect(value).not.toMatch(/[\\/]/);
    }
  });

  test('mounting both surfaces together yields exactly one project control', () => {
    const transport = createFakeTransport();
    const client = new DaemonClient(transport, createFakeScheduler());
    render(
      <DaemonProvider client={client}>
        <OwnerControlPlane />
        <SafetyProviders />
      </DaemonProvider>,
    );
    client.start();
    act(() => transport.emit(INVENTORY));

    expect(screen.getAllByTestId('project-select')).toHaveLength(1);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });
});
