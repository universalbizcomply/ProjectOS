// @vitest-environment jsdom
/**
 * ADDING A FILE MUST NOT BECOME A SECOND WAY TO DRIVE THE PROJECT.
 *
 * The Files tab is the first owner surface that writes to disk, and the temptation is a governed
 * verb carrying a path. There isn't one. Adding a file is two host calls — a picker and a copy — and
 * the copy is given this project's IDENTITY, never a folder: the destination is resolved on the
 * trusted side from the protected registry.
 *
 * These tests exist to stop that drifting. They assert that no governed command is dispatched by any
 * part of this flow, that the copy call never carries a destination, and that cancelling the picker
 * cannot mutate anything — the case where an owner backs out and a file appears anyway.
 *
 * Created in PROJECTOS-GOVERNED-UPLOAD-SEAM-IMPLEMENT1A.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ProjectHome } from '../src/ux/ProjectHome';
import { addProjectFile, loadProjectFiles, formatSize, formatImported, purposeLabel } from '../src/ux/filesModel';
import * as governedClient from '../src/governed/governedClient';
import type { IpcBridge } from '../src/daemon/ipcBridge';
import type { GovernedProjection } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A host that answers the two file commands and records every call. */
function host(
  answers: { pick?: string | null; imported?: unknown; files?: unknown[] } = {},
): IpcBridge & { calls: Array<{ cmd: string; args: Record<string, unknown> | undefined }> } {
  const calls: Array<{ cmd: string; args: Record<string, unknown> | undefined }> = [];
  return {
    calls,
    isTauri: () => true,
    listen: async () => () => {},
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      if (cmd === 'pick_file') return answers.pick === undefined ? null : answers.pick;
      if (cmd === 'import_project_file') {
        return answers.imported ?? { ok: true, file_name: 'brief.md', refusal: null, message: 'brief.md was added to this project.' };
      }
      if (cmd === 'list_project_files') return { ok: true, files: answers.files ?? [], message: '' };
      return null;
    },
  };
}

function projection(): GovernedProjection {
  return {
    connected: true,
    projectId: 'polygo',
    projectName: 'PolyGo',
    repository: { repo: 'acme/polygo', localPath: 'C:/dev/polygo', branch: 'main', head: 'a'.repeat(40), protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'P', planVersion: '1.0', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: '.projectops/plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 0, totalPhaseCount: 0, completionPercentage: 0, completedPhases: [], pendingPhases: [] },
    phases: [],
    activePhase: null,
    nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    pendingApprovals: [],
    planDrafts: [],
    sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: '',
    observedAt: '2026-08-29T18:00:00.000Z',
  } as GovernedProjection;
}

function filesTab(bridge: IpcBridge) {
  return render(
    <ProjectHome
      state={projection()}
      tab="files"
      setTab={() => {}}
      now={Date.parse('2026-08-29T18:00:00.000Z')}
      onPrimary={() => {}}
      onOpenAdvanced={() => {}}
      onOpenPlanDetail={() => {}}
      onRequestChange={() => {}}
      bridge={bridge}
    />,
  );
}

describe('the Files tab tells the truth about itself', () => {
  test('an empty project says so, and no longer claims files are impossible', async () => {
    const bridge = host({ files: [] });
    filesTab(bridge);

    await waitFor(() => expect(screen.getByText('No files have been added to this project yet.')).toBeTruthy());
    // The old placeholder was truthful when there was no capability. Repeating it now would not be.
    expect(document.body.textContent ?? '').not.toContain('cannot take files from you');
  });

  test('it says what these files are for, and what they are not', async () => {
    const bridge = host({ files: [] });
    filesTab(bridge);
    await waitFor(() => expect(bridge.calls.some((c) => c.cmd === 'list_project_files')).toBe(true));

    const body = document.body.textContent ?? '';
    expect(body).toContain('stored with the project');
    expect(body).toContain('not used to write plans');
  });

  test('Add a file is present, with a purpose to choose', async () => {
    const bridge = host({ files: [] });
    filesTab(bridge);

    expect(screen.getByRole('button', { name: 'Add a file' })).toBeTruthy();
    expect(screen.getByLabelText('What is this file?')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Specification or brief' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Evidence' })).toBeTruthy();
  });

  test('imported files are listed with what an owner needs to recognise them', async () => {
    const bridge = host({
      files: [{ file_name: 'booking-spec.md', purpose: 'SPECIFICATION', size_bytes: 2048, imported_at_epoch_ms: Date.parse('2026-08-20T10:00:00Z') }],
    });
    filesTab(bridge);

    await waitFor(() => expect(screen.getByText('booking-spec.md')).toBeTruthy());
    const body = document.body.textContent ?? '';
    expect(body).toContain('Specification or brief');
    expect(body).toContain('2 KB');
  });

  test('the listing is asked for THIS project, by identity', async () => {
    const bridge = host({ files: [] });
    filesTab(bridge);

    await waitFor(() => expect(bridge.calls.some((c) => c.cmd === 'list_project_files')).toBe(true));
    const call = bridge.calls.find((c) => c.cmd === 'list_project_files')!;
    expect(call.args).toEqual({ projectId: 'polygo' });
  });
});

describe('adding a file dispatches no governed command and names no destination', () => {
  test('the whole flow is two host calls, and neither is a governed verb', async () => {
    const governed = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: [] });
    const bridge = host({ pick: 'C:\\Users\\murad\\Documents\\brief.md' });
    filesTab(bridge);

    fireEvent.click(screen.getByRole('button', { name: 'Add a file' }));
    await waitFor(() => expect(bridge.calls.some((c) => c.cmd === 'import_project_file')).toBe(true));

    expect(governed).not.toHaveBeenCalled();
    const commands = bridge.calls.map((c) => c.cmd);
    expect(new Set(commands)).toEqual(new Set(['list_project_files', 'pick_file', 'import_project_file']));
  });

  test('the copy carries an identity and a source — never a destination', async () => {
    const bridge = host({ pick: 'C:\\Users\\murad\\Documents\\brief.md' });
    filesTab(bridge);

    fireEvent.click(screen.getByRole('button', { name: 'Add a file' }));
    await waitFor(() => expect(bridge.calls.some((c) => c.cmd === 'import_project_file')).toBe(true));

    const call = bridge.calls.find((c) => c.cmd === 'import_project_file')!;
    expect(call.args).toEqual({
      projectId: 'polygo',
      sourcePath: 'C:\\Users\\murad\\Documents\\brief.md',
      purpose: 'SPECIFICATION',
    });
    // The renderer has no way to say WHERE. If one is ever added, this fails.
    for (const key of ['projectRoot', 'destination', 'destinationPath', 'root', 'targetPath']) {
      expect(call.args).not.toHaveProperty(key);
    }
  });

  test('the chosen purpose is the one sent', async () => {
    const bridge = host({ pick: 'C:\\docs\\evidence.pdf' });
    filesTab(bridge);

    fireEvent.change(screen.getByLabelText('What is this file?'), { target: { value: 'EVIDENCE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a file' }));

    await waitFor(() => expect(bridge.calls.some((c) => c.cmd === 'import_project_file')).toBe(true));
    expect(bridge.calls.find((c) => c.cmd === 'import_project_file')!.args!['purpose']).toBe('EVIDENCE');
  });

  test('a success is reported and the list is read again', async () => {
    const bridge = host({ pick: 'C:\\docs\\brief.md' });
    filesTab(bridge);
    await waitFor(() => expect(bridge.calls.filter((c) => c.cmd === 'list_project_files')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Add a file' }));

    await waitFor(() => expect(screen.getByText('brief.md was added to this project.')).toBeTruthy());
    await waitFor(() => expect(bridge.calls.filter((c) => c.cmd === 'list_project_files').length).toBeGreaterThan(1));
  });

  test("a refusal shows the host's sentence and nothing is claimed to have been added", async () => {
    const bridge = host({
      pick: 'C:\\docs\\tool.exe',
      imported: {
        ok: false,
        file_name: null,
        refusal: 'UNSUPPORTED_TYPE',
        message: 'Programs and scripts cannot be added to a project. Choose a document instead.',
      },
    });
    filesTab(bridge);

    fireEvent.click(screen.getByRole('button', { name: 'Add a file' }));

    await waitFor(() =>
      expect(screen.getByText('Programs and scripts cannot be added to a project. Choose a document instead.')).toBeTruthy(),
    );
    expect(screen.getByText('No files have been added to this project yet.')).toBeTruthy();
  });
});

describe('cancelling cannot change anything', () => {
  test('no import call is made when the picker is cancelled', async () => {
    const bridge = host({ pick: null });
    const outcome = await addProjectFile(bridge, 'polygo', 'REFERENCE');

    expect(outcome.kind).toBe('CANCELLED');
    expect(bridge.calls.map((c) => c.cmd)).toEqual(['pick_file']);
  });

  test('cancelling from the tab leaves the screen as it was, with nothing said', async () => {
    const bridge = host({ pick: null });
    filesTab(bridge);
    await waitFor(() => expect(bridge.calls.some((c) => c.cmd === 'list_project_files')).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Add a file' }));

    await waitFor(() => expect(bridge.calls.some((c) => c.cmd === 'pick_file')).toBe(true));
    expect(bridge.calls.some((c) => c.cmd === 'import_project_file')).toBe(false);
    expect(screen.getByText('No files have been added to this project yet.')).toBeTruthy();
  });
});

describe('what the surface does with what the host reports', () => {
  test('an unreadable listing is empty, never a guess', async () => {
    const refusing: IpcBridge = {
      isTauri: () => true,
      listen: async () => () => {},
      invoke: async () => ({ ok: false, files: [], message: 'ProjectOS could not find that project on this computer.' }),
    };
    expect(await loadProjectFiles(refusing, 'polygo')).toEqual([]);
  });

  test('a file whose record is missing is still shown, with the unknown parts left out', async () => {
    const bridge = host({
      files: [{ file_name: 'orphan.md', purpose: null, size_bytes: 500, imported_at_epoch_ms: null }],
    });
    filesTab(bridge);

    await waitFor(() => expect(screen.getByText('orphan.md')).toBeTruthy());
    expect(screen.getByText('500 bytes')).toBeTruthy();
  });

  test('sizes and dates are the owner-facing forms, and absent facts are not invented', () => {
    expect(formatSize(900)).toBe('900 bytes');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatImported(null)).toBeNull();
    expect(purposeLabel(null)).toBeNull();
    expect(purposeLabel('NOT_A_PURPOSE')).toBeNull();
    expect(purposeLabel('EVIDENCE')).toBe('Evidence');
  });
});
