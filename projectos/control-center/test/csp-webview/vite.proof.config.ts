import { fileURLToPath } from 'node:url';
import { mergeConfig, type Plugin } from 'vite';
import base from '../../vite.config';

/**
 * Neutralise `Buffer.from` in the one module that calls it at load time, and leave `Buffer` undefined
 * everywhere else, so no library's `typeof Buffer` check changes behaviour under the proof.
 */
const hostWireConstants: Plugin = {
  name: 'csp-proof-host-wire-constants',
  transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/core/dist/hostReviewWire.js')) return null;
    return code.replaceAll('Buffer.from(', '((..._unused) => null)(');
  },
};

/**
 * The app's own Vite config plus the two things the browser bundle needs at b0768486 to exist at all.
 *
 * Neither is about the CSP. `npm run build` fails on `node:buffer`, and with that aliased the bundle blanks
 * with "Buffer is not defined", because hostReviewWire.ts, reached through the `@projectos/core` barrel, runs
 * `Buffer.from` at the top level. Those values are host-review constants the browser never reads. The real
 * fix belongs in vite.config.ts or in the core barrel, outside this phase's write paths;
 * docs/finish/PROJECTOS-TENANT-CSP1A.md names it.
 */
export default mergeConfig(base, {
  plugins: [hostWireConstants],
  resolve: {
    alias: {
      'node:buffer': fileURLToPath(new URL('./nodeBufferStub.ts', import.meta.url)),
    },
  },
});
