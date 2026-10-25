/**
 * Fixture entry — TEST-ONLY. Mounts the isolated Mission Control fixture and installs a network
 * guard that records any fetch/XHR attempt so the desktop harness can assert ZERO external I/O.
 * Reuses the production stylesheet (real component classes) + a fixture-only stylesheet.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FixtureApp } from './FixtureApp';
import '../../src/styles.css';
import './fixture.css';

interface NetWindow {
  __NET_CALLS__?: string[];
  __NET_GUARD__?: Record<string, boolean>;
}

/**
 * Record (do not block) every network primitive the WebView exposes, so the desktop harness can
 * assert ZERO external I/O and know exactly which primitives were instrumentable. Test-only.
 */
function installNetGuard(): void {
  const w = window as unknown as NetWindow;
  const calls: string[] = [];
  w.__NET_CALLS__ = calls;
  const cov: Record<string, boolean> = {
    fetch: false,
    xhr: false,
    websocket: false,
    eventsource: false,
    sendbeacon: false,
  };
  const push = (u: unknown) => calls.push(typeof u === 'string' ? u : String(u));

  if (typeof window.fetch === 'function') {
    const origFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      push(input instanceof URL ? input.toString() : input);
      return origFetch(input, init);
    }) as typeof fetch;
    cov.fetch = true;
  }

  if (typeof XMLHttpRequest !== 'undefined') {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function open(this: XMLHttpRequest, _method: string, url: string | URL): void {
      push(url);
      origOpen.apply(this, arguments as unknown as Parameters<XMLHttpRequest['open']>);
    } as XMLHttpRequest['open'];
    cov.xhr = true;
  }

  if (typeof WebSocket !== 'undefined') {
    const OrigWS = WebSocket;
    class WrappedWS extends OrigWS {
      constructor(url: string | URL, protocols?: string | string[]) {
        push(url);
        super(url, protocols);
      }
    }
    (window as unknown as { WebSocket: typeof WebSocket }).WebSocket = WrappedWS as unknown as typeof WebSocket;
    cov.websocket = true;
  }

  if (typeof EventSource !== 'undefined') {
    const OrigES = EventSource;
    class WrappedES extends OrigES {
      constructor(url: string | URL, init?: EventSourceInit) {
        push(url);
        super(url, init);
      }
    }
    (window as unknown as { EventSource: typeof EventSource }).EventSource = WrappedES as unknown as typeof EventSource;
    cov.eventsource = true;
  }

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null) => {
      push(url);
      return origBeacon(url, data ?? undefined);
    }) as typeof navigator.sendBeacon;
    cov.sendbeacon = true;
  }

  w.__NET_GUARD__ = cov;
}

installNetGuard();

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <FixtureApp />
    </React.StrictMode>,
  );
}
