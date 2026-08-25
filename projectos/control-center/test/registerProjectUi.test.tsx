// @vitest-environment jsdom
/**
 * Add-a-project registration surface (PROJECTOS-PRODUCT-COMPLETION1A §11).
 *
 * The renderer must be able to ASK for a registration and nothing more. These pin the properties
 * that keep it that way: it invokes one named host command with exactly the four declared values,
 * it never assembles a command line, it reports the host's own words on refusal rather than
 * inventing success, and it offers no route at all where no native host exists to ask.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { RegisterProjectGuide } from '../src/owner/RegisterProjectGuide.js';
import { tauriBridge } from '../src/daemon/tauriBridge.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Open the <details> so the form inside is interactable. */
function open() {
  render(<RegisterProjectGuide />);
  fireEvent.click(screen.getByText('Add a project'));
}

function fill(id: string, root: string) {
  fireEvent.change(screen.getByLabelText('Project ID'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('Project folder (full path)'), { target: { value: root } });
}

describe('the renderer asks the host; it does not register anything itself', () => {
  test('invokes the one named host command with exactly the declared values', async () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
    const invoke = vi.spyOn(tauriBridge, 'invoke').mockResolvedValue('REGISTERED');
    open();
    fill('projectos', 'C:\\dev\\ProjectOS');
    fireEvent.click(screen.getByRole('button', { name: 'Register project' }));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const [command, args] = invoke.mock.calls[0]!;
    expect(command).toBe('register_project');
    expect(args).toEqual({
      projectId: 'projectos',
      repositoryRoot: 'C:\\dev\\ProjectOS',
      environments: ['development'],
      productionFrozen: true,
    });
  });

  test('a host refusal is shown in the host\'s own words, never as success', async () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
    vi.spyOn(tauriBridge, 'invoke').mockRejectedValue('That folder is not usable.');
    open();
    fill('projectos', 'not-a-path');
    fireEvent.click(screen.getByRole('button', { name: 'Register project' }));

    expect(await screen.findByText('That folder is not usable.')).toBeTruthy();
    expect(screen.queryByText(/is registered/)).toBeNull();
  });

  test('declining the native confirmation is reported as nothing written', async () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
    vi.spyOn(tauriBridge, 'invoke').mockResolvedValue('DECLINED');
    open();
    fill('projectos', 'C:\\dev\\ProjectOS');
    fireEvent.click(screen.getByRole('button', { name: 'Register project' }));

    expect(await screen.findByText('Cancelled. Nothing was written.')).toBeTruthy();
  });

  test('with no native host there is no route to try — the control is unavailable', () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(false);
    const invoke = vi.spyOn(tauriBridge, 'invoke');
    open();
    fill('projectos', 'C:\\dev\\ProjectOS');
    expect((screen.getByRole('button', { name: 'Register project' }) as HTMLButtonElement).disabled).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  test('nothing is sent until every required value is present', () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
    const invoke = vi.spyOn(tauriBridge, 'invoke');
    open();
    fill('projectos', '');
    expect((screen.getByRole('button', { name: 'Register project' }) as HTMLButtonElement).disabled).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});
