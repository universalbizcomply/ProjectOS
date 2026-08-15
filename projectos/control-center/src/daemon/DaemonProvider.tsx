/**
 * DaemonProvider + hooks — bind the read-only DaemonClient into React via useSyncExternalStore.
 *
 * In a plain web build the client uses NullTransport (shows Disconnected, keeps retrying). A
 * Node/Tauri host injects a live client built on InProcessTransport. Components read slices;
 * only the components whose slice changed repaint.
 */
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { DaemonClient } from './daemonClient.js';
import { createDesktopTransport } from './selectTransport.js';
import { tauriBridge } from './tauriBridge.js';
import { realScheduler } from './realScheduler.js';
import type {
  ConnectionState,
  LiveHealth,
  LiveLifecycle,
  LiveNotification,
  LivePhase,
  LiveProjectSummary,
  LiveState,
  LiveWorker,
  LiveEvent,
} from './types.js';
import type { GovernedState, GovernedProjectsInventory } from '../governed/types.js';

const DaemonContext = createContext<DaemonClient | null>(null);

export function DaemonProvider({
  client,
  children,
}: {
  client?: DaemonClient;
  children: ReactNode;
}) {
  const daemon = useMemo(
    () => client ?? new DaemonClient(createDesktopTransport(tauriBridge), realScheduler),
    [client],
  );
  useEffect(() => {
    daemon.start();
    return () => daemon.stop();
  }, [daemon]);
  return <DaemonContext.Provider value={daemon}>{children}</DaemonContext.Provider>;
}

export function useDaemon(): DaemonClient {
  const c = useContext(DaemonContext);
  if (c === null) throw new Error('useDaemon must be used within a DaemonProvider');
  return c;
}

function useSlice<T>(select: (s: LiveState) => T): T {
  const daemon = useDaemon();
  const get = () => select(daemon.store.getState());
  return useSyncExternalStore(daemon.store.subscribe, get, get);
}

export const useConnection = (): ConnectionState => useSlice((s) => s.connection);
export const useReconnectAttempt = (): number => useSlice((s) => s.reconnectAttempt);
/** The host's authoritative worker lifecycle; `null` outside the desktop host. */
export const useLifecycle = (): LiveLifecycle | null => useSlice((s) => s.lifecycle);
export const useHealth = (): LiveHealth | null => useSlice((s) => s.health);
export const useWorkers = (): readonly LiveWorker[] => useSlice((s) => s.workers);
export const usePhases = (): readonly LivePhase[] => useSlice((s) => s.phases);
export const useLiveProjects = (): readonly LiveProjectSummary[] => useSlice((s) => s.projects);
export const useEvents = (): readonly LiveEvent[] => useSlice((s) => s.events);
export const useNotifications = (): readonly LiveNotification[] => useSlice((s) => s.notifications);
/**
 * Canonical governed state from the ProjectOS runtime. `null` means the runtime has not reported
 * yet — which the owner surface must render as "not connected", never as an assumed-good default.
 */
export const useGovernedState = (): GovernedState | null => useSlice((s) => s.governed);
/**
 * The installed projects this ProjectOS may govern, and which one is selected.
 *
 * `null` means the runtime has not reported an inventory yet. It is NOT "there are no projects" and
 * must never be rendered as one — the difference matters, because one invites the owner to register
 * a project and the other invites them to wait.
 */
export const useGovernedProjects = (): GovernedProjectsInventory | null =>
  useSlice((s) => s.governedProjects);
