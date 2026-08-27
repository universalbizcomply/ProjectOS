/**
 * Design-fidelity proof entry — TEST-ONLY.
 *
 * Mounts the REAL shell (`src/App.tsx`'s `Shell`) inside a `DaemonProvider` driven by a scripted
 * transport, so every screen and state the approved design draws can be opened at a chosen viewport
 * and compared with the prototype. `?state=` selects the governed state; `?shell=` forces an
 * appearance; `?calm=1` exercises Softer motion.
 *
 * Nothing here is reachable from the application, and `npm run build` never sees it.
 */
import React, { useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { DaemonProvider } from '../../src/daemon/DaemonProvider';
import { DaemonClient } from '../../src/daemon/daemonClient';
import type { DaemonTransport, Scheduler, TransportListener } from '../../src/daemon/ports';
import type { TransportMessage } from '../../src/daemon/types';
import { Shell } from '../../src/App';
import { tauriBridge } from '../../src/daemon/tauriBridge';
import { inventoryFor, projectionFor, type ProofState } from './proofState';
import '../../src/styles.css';

const params = new URLSearchParams(window.location.search);
const state = (params.get('state') ?? 'idle') as ProofState;
const shell = params.get('shell');
const calm = params.get('calm');

// The proof harness drives the appearance directly, so a screenshot run never depends on whatever
// the last session happened to leave in localStorage.
try {
  if (shell === 'standard' || shell === 'command') window.localStorage.setItem('projectos.shell-theme', shell);
  if (calm !== null) window.localStorage.setItem('projectos.calm-motion', calm === '1' ? '1' : '0');
} catch {
  /* site data blocked — the defaults still render */
}

/**
 * `?host=fake` — a scripted stand-in for the native host, so the Add Project wizard's four steps can
 * be photographed in a browser. It answers the five commands the wizard actually calls, in the order
 * it calls them, and does nothing else: no registry is touched, no credential is stored, and this
 * file is never part of a production build.
 */
if (params.get('host') === 'fake') {
  const prepared = new Set<string>();
  const bridge = tauriBridge as { isTauri: () => boolean; invoke: (c: string, a?: unknown) => Promise<unknown> };
  bridge.isTauri = () => true;
  bridge.invoke = async (command, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    if (command === 'pick_folder') return 'C:\\dev\\BookingApp';
    if (command === 'inspect_folder') {
      const path = String(a['path'] ?? '');
      return prepared.has(path)
        ? {
            readiness: 'READY',
            summary: 'ProjectOS set itself up inside the folder. Your files were not touched.',
            next_step: 'This folder is ready.',
            findings: [
              'Version history in place — work can always be rolled back',
              'Its own settings written inside the folder',
              'Live site frozen until you approve a change',
            ],
            git_marker: 'repository', has_projectops: true, declared_project_id: 'booking-app',
            branch: 'main', remote: null, dirty_count: 0, registered_as: null,
          }
        : {
            readiness: 'NEEDS_PREPARATION',
            summary: 'ProjectOS can work here. It needs to add its own small setup first.',
            next_step: 'Set it up to continue.',
            findings: ['ProjectOS adds version history so work can be undone'],
            git_marker: 'none', has_projectops: false, declared_project_id: null,
            branch: null, remote: null, dirty_count: null, registered_as: null,
          };
    }
    if (command === 'prepare_folder') {
      prepared.add(String(a['path'] ?? ''));
      return { ok: true, actions: ['Version history in place — work can always be rolled back'] };
    }
    if (command === 'register_project') return 'REGISTERED';
    if (command === 'set_credential') return 'STORED';
    return null;
  };
}

function scriptedTransport(): DaemonTransport & { emit: (m: TransportMessage) => void } {
  const listeners = new Set<TransportListener>();
  return {
    kind: 'design-proof',
    connect() {},
    disconnect() {},
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestSnapshot() {},
    emit(message) {
      for (const l of listeners) l(message);
    },
  };
}

/**
 * A scheduler that never fires. The client's heartbeat and reconnect backoff exist to notice a real
 * daemon going quiet; against a scripted transport they would do exactly that and repaint the whole
 * shell as "not reporting", which is not the state being photographed.
 */
const frozen: Scheduler = {
  setTimer: () => 0,
  clearTimer: () => undefined,
  now: () => Date.now(),
};

function Harness() {
  const transport = useMemo(scriptedTransport, []);
  const client = useMemo(() => new DaemonClient(transport, frozen), [transport]);

  useEffect(() => {
    transport.emit({
      kind: 'snapshot',
      snapshot: {
        health: { running: true, version: '0.1.0', uptimeMs: 60_000, projects: 6, workers: 1, watchers: 1, pendingEvents: 0, pendingPrompts: 0, pendingReports: 0, pendingApprovals: 0, recovered: false },
        workers: [], phases: [], projects: [], notifications: [],
      },
    } as TransportMessage);
    transport.emit({
      kind: 'lifecycle',
      lifecycle: { state: 'RUNNING_READ_ONLY', readOnlyAvailable: true, protectedApprovalsDisabled: true, nextSafeAction: 'Local worker ready for read-only operation.' },
    } as TransportMessage);
    transport.emit({ kind: 'governed-projects', inventory: inventoryFor(state) } as TransportMessage);
    if (state !== 'offline') {
      transport.emit({ kind: 'governed', state: projectionFor(state) } as TransportMessage);
    } else {
      transport.emit({
        kind: 'governed',
        state: { connected: false, reason: 'RUNTIME_STOPPED', detail: 'The local ProjectOS runtime is not running.' },
      } as TransportMessage);
    }
    if (state === 'running') {
      transport.emit({ kind: 'run-started', root: 'C:\\dev\\PolyGo', phaseId: 'P4', resumed: false } as TransportMessage);
    }
  }, [transport]);

  return (
    <DaemonProvider client={client}>
      <Shell canChangePassword onChangePassword={() => undefined} />
    </DaemonProvider>
  );
}

const el = document.getElementById('root');
if (el) createRoot(el).render(<React.StrictMode><Harness /></React.StrictMode>);
