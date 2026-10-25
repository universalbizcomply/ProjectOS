/**
 * The agent's LOCAL IPC edge to ProjectOSHost — the one place this process touches the Host's pipe and
 * the two derived-name files of a review.
 *
 * DELIBERATELY DUMB. It moves bytes: it writes one subject file, performs one exchange on one
 * connection, and reads one record file. It decodes nothing it returns, judges nothing, retries nothing
 * and decides nothing — every judgement belongs to `hostReviewClient.ts`, which re-verifies every frame
 * and the whole record with the strict core codec. A transport that interpreted what it carried would be
 * a second opinion about the wire, and a transport that retried would turn one governed question into
 * several.
 *
 * THE ONE THING IT MUST DECIDE MID-CONNECTION is whether to send the request at all, because the answer
 * arrives on the same connection the request would go out on: the Host's own status record says whether
 * it is accepting protected operations. Every installed service today says it is NOT, so the request is
 * WITHHELD and nothing is written — a dormant Host is a clean "never sent", not a question posted into a
 * connection nobody reads. That check is byte-exact and minimal here, and is repeated strictly by the
 * client on the frames this returns.
 *
 * NO CREDENTIAL EXISTS IN THIS PROCESS OR IN THE CHILD. The frames are fixed-width digests; the subject
 * is a question. There is no provider client anywhere on this path.
 *
 * ONE ENDPOINT, ONE ROOT. `nodeHostIpcTransport()` takes no endpoint and reads no environment: it is bound
 * to the installed Host's fixed pipe and fixed state root. The isolated-test factory is a
 * separate export that can name ONLY a pipe in the `ProjectOS.Test.` namespace.
 *
 * SYNCHRONOUS OVER AN ASYNCHRONOUS SOCKET, for the reason `nodeHttpPort` is: every seam in the loop is
 * synchronous, so the one asynchronous exchange happens in a child process and is awaited there.
 *
 * Created in PROJECTOS-HOST-REVIEW-PATH1A.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, fsyncSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOST_INBOX_LEAF,
  HOST_MAX_RESPONSE_RECORD_BYTES,
  HOST_OUTBOX_LEAF,
  HOST_REQUEST_EXTENSION,
  HOST_RESPONSE_EXTENSION,
  HOST_RESPONSE_FRAME_LEN,
  HOST_SERVICE_READY_FRAME_LEN,
  HOST_STATUS_FRAME_LEN,
  INSTALLED_HOST_RUN_ID,
  hostExchangeFileName,
} from '@projectos/core';

/** The installed Host's ONE fixed endpoint. Mirrors `PRODUCTION_ENDPOINT` in `windows_ffi.rs`. */
export const INSTALLED_HOST_ENDPOINT = '\\\\.\\pipe\\ProjectOS.Host';
/** The only other namespace this transport can ever name. */
const TEST_ENDPOINT = /^\\\\\.\\pipe\\ProjectOS\.Test\.[A-Za-z0-9.]{1,96}$/;

export type SubjectWrite = 'written' | 'failed';

export type HostIpcExchange =
  /** NOTHING WAS SENT. `stage` says how far the connection got. */
  | { readonly kind: 'not-sent'; readonly stage: 'connect' | 'handshake' | 'status' | 'withheld'; readonly detail: string; readonly readyFrame: Buffer | null; readonly statusFrame: Buffer | null }
  /** THE REQUEST WAS WRITTEN. `responseFrame` is null when no answer arrived. */
  | { readonly kind: 'sent'; readonly readyFrame: Buffer; readonly statusFrame: Buffer; readonly responseFrame: Buffer | null; readonly detail: string };

export interface HostIpcTransport {
  /** The run identifier both ends derive the exchange nonce from. */
  readonly runId: Buffer;
  /** Write the subject under its DERIVED name. Idempotent for identical bytes; never overwrites others. */
  writeSubject(correlation: string, bytes: Buffer): SubjectWrite;
  /** Remove a subject this process wrote, after a request that was never sent. Best effort. */
  discardSubject(correlation: string): void;
  /** ONE connection: hello, ready, status, the pre-send gate, the request, the response. */
  exchange(frames: { readonly hello: Buffer; readonly expectedReady: Buffer; readonly request: Buffer; readonly responseTimeoutMs: number }): HostIpcExchange;
  /** The exact bytes of the response record, or null when absent, unreadable or over the bound. */
  readResponseRecord(correlation: string): Buffer | null;
}

/**
 * The installed Host's state root. A CONSTANT, NOT AN ENVIRONMENT READ.
 *
 * It was `process.env.ProgramData` first, and the security review showed why that is wrong: a per-user
 * `ProgramData` variable overrides the machine one, so code running as the owner — which is exactly the
 * tier this route exists to be independent OF — could point the agent at a directory it controls, squat
 * the pipe name while the Host is between instances, and serve a forged "attested" record from its own
 * outbox. With the root fixed, a squatter can still make the route UNAVAILABLE but cannot supply a
 * record: the real outbox is writable by the Host alone. A machine whose ProgramData is not on `C:` fails
 * closed here — the route is unavailable, never redirected.
 */
export const INSTALLED_HOST_STATE_ROOT = 'C:\\ProgramData\\ProjectOS\\host';

/** The production transport: the installed Host's fixed endpoint and fixed state root. No parameters. */
export function nodeHostIpcTransport(): HostIpcTransport {
  return transport(INSTALLED_HOST_ENDPOINT, INSTALLED_HOST_RUN_ID, INSTALLED_HOST_STATE_ROOT);
}

/**
 * ISOLATED TESTS ONLY. Names a pipe in the `ProjectOS.Test.` namespace and a scratch state root. It
 * cannot name the installed Host's endpoint, and no command composes it.
 */
export function nodeHostIpcTransportForIsolatedTest(input: { readonly endpoint: string; readonly runId: Buffer; readonly stateRoot: string }): HostIpcTransport {
  if (!TEST_ENDPOINT.test(input.endpoint)) throw new Error('an isolated-test Host endpoint must be in the ProjectOS.Test. pipe namespace');
  if (input.runId.length !== 8 || input.runId.equals(INSTALLED_HOST_RUN_ID)) throw new Error('an isolated-test run identifier is 8 bytes and is never the installed Host identifier');
  return transport(input.endpoint, input.runId, input.stateRoot);
}

function transport(endpoint: string, runId: Buffer, stateRoot: string): HostIpcTransport {
  const subjectPath = (correlation: string): string | null => {
    const name = hostExchangeFileName(correlation, HOST_REQUEST_EXTENSION);
    return name === null ? null : join(stateRoot, HOST_INBOX_LEAF, name);
  };
  return {
    runId,
    writeSubject(correlation, bytes): SubjectWrite {
      const path = subjectPath(correlation);
      if (path === null) return 'failed';
      let fd: number | null = null;
      try {
        // 'wx' — create, and FAIL if it exists. The exclusivity is the filesystem's.
        fd = openSync(path, 'wx');
        writeSync(fd, bytes);
        fsyncSync(fd);
        return 'written';
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return 'failed';
        // THE SAME QUESTION, ASKED AGAIN. The name is derived from the request, so an identical file is
        // this request's own subject from an attempt that never reached the Host. Different bytes under
        // this name are somebody else's, and are never overwritten.
        try {
          return readFileSync(path).equals(bytes) ? 'written' : 'failed';
        } catch {
          return 'failed';
        }
      } finally {
        if (fd !== null) closeSync(fd);
      }
    },
    discardSubject(correlation): void {
      const path = subjectPath(correlation);
      if (path === null) return;
      try {
        rmSync(path, { force: true });
      } catch {
        // BEST EFFORT MEANS IT CANNOT THROW. `force` silences only a missing file; a locked or
        // protected one still throws, and a throw here would lose the outcome the caller has already
        // established. A subject left behind is inert: the Host reads each one at most once.
      }
    },
    exchange(frames): HostIpcExchange {
      const result = spawnSync(process.execPath, ['-e', CHILD_SCRIPT], {
        input: JSON.stringify({
          endpoint,
          hello: frames.hello.toString('hex'),
          expectedReady: frames.expectedReady.toString('hex'),
          request: frames.request.toString('hex'),
          readyLen: HOST_SERVICE_READY_FRAME_LEN,
          statusLen: HOST_STATUS_FRAME_LEN,
          responseLen: HOST_RESPONSE_FRAME_LEN,
          connectTimeoutMs: 3_000,
          preambleTimeoutMs: 5_000,
          responseTimeoutMs: frames.responseTimeoutMs,
        }),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        // The child's own deadline plus a margin: a child that hangs must not hang the loop.
        timeout: frames.responseTimeoutMs + 15_000,
      });
      const hexOrNull = (v: unknown): Buffer | null => (typeof v === 'string' && /^([0-9a-f]{2})*$/.test(v) && v !== '' ? Buffer.from(v, 'hex') : null);
      let parsed: Record<string, unknown> | null = null;
      try {
        const v: unknown = JSON.parse(result.stdout ?? '');
        parsed = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
      } catch {
        parsed = null;
      }
      const ready = hexOrNull(parsed?.['ready']);
      const status = hexOrNull(parsed?.['status']);
      const detail = typeof parsed?.['detail'] === 'string' ? (parsed['detail'] as string).slice(0, 200) : 'the Host exchange process returned nothing usable';
      if (parsed !== null && parsed['sent'] === true && ready !== null && status !== null) {
        return { kind: 'sent', readyFrame: ready, statusFrame: status, responseFrame: hexOrNull(parsed['response']), detail };
      }
      if (parsed !== null && parsed['sent'] === false) {
        const stage = parsed['stage'];
        return {
          kind: 'not-sent',
          stage: stage === 'handshake' || stage === 'status' || stage === 'withheld' ? stage : 'connect',
          detail,
          readyFrame: ready,
          statusFrame: status,
        };
      }
      // THE CHILD DIED OR SAID NOTHING PARSEABLE, so whether the request was written is UNKNOWN. That is
      // reported as sent-and-unanswered: money that may have been spent is never released on a guess.
      return { kind: 'sent', readyFrame: ready ?? Buffer.alloc(0), statusFrame: status ?? Buffer.alloc(0), responseFrame: null, detail };
    },
    readResponseRecord(correlation): Buffer | null {
      const name = hostExchangeFileName(correlation, HOST_RESPONSE_EXTENSION);
      if (name === null) return null;
      const path = join(stateRoot, HOST_OUTBOX_LEAF, name);
      try {
        const st = statSync(path);
        if (!st.isFile() || st.size === 0 || st.size > HOST_MAX_RESPONSE_RECORD_BYTES) return null;
        return readFileSync(path);
      } catch {
        return null;
      }
    },
  };
}

/**
 * The child. Reads the exchange from stdin, writes ONE JSON line to stdout, prints nothing else.
 *
 * `sent` is the fact the parent's budget depends on, so it is set to true ONLY at the moment the request
 * write is issued, and every exit before that reports `sent:false` with the stage reached.
 */
const CHILD_SCRIPT = `
const net = require('node:net');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let done = false;
  const out = { sent: false, stage: 'connect', detail: '', ready: '', status: '', response: '' };
  const finish = (detail) => {
    if (done) return;
    done = true;
    out.detail = detail;
    process.stdout.write(JSON.stringify(out), () => process.exit(0));
  };
  let req;
  try { req = JSON.parse(raw); } catch { return finish('the exchange request was unreadable'); }
  const expectedReady = Buffer.from(req.expectedReady, 'hex');
  let buf = Buffer.alloc(0);
  let timer = setTimeout(() => { sock.destroy(); finish('the Host endpoint did not accept a connection in time'); }, req.connectTimeoutMs);
  const arm = (ms, why) => { clearTimeout(timer); timer = setTimeout(() => { sock.destroy(); finish(why); }, ms); };
  const sock = net.connect(req.endpoint);
  sock.on('error', (e) => finish(out.sent ? 'the connection failed after the request was written' : 'the Host endpoint could not be reached: ' + String(e && e.code || 'error')));
  sock.on('close', () => finish(out.sent ? 'the Host closed the connection without answering' : 'the Host closed the connection before a request was sent'));
  sock.on('connect', () => {
    out.stage = 'handshake';
    arm(req.preambleTimeoutMs, 'the Host did not complete the status exchange in time');
    sock.write(Buffer.from(req.hello, 'hex'));
  });
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (out.ready === '' && buf.length >= req.readyLen) {
      const ready = buf.subarray(0, req.readyLen);
      out.ready = ready.toString('hex');
      if (!ready.equals(expectedReady)) { sock.destroy(); return finish('the Host did not answer with the expected ServiceReady'); }
      out.stage = 'status';
    }
    if (out.ready !== '' && out.status === '' && buf.length >= req.readyLen + req.statusLen) {
      const status = buf.subarray(req.readyLen, req.readyLen + req.statusLen);
      out.status = status.toString('hex');
      // Same header as ServiceReady except the kind byte (8) and the payload length; then the fifth
      // payload byte is the protected-operations report, and 2 is Authorised.
      const headerOk = status.subarray(0, 6).equals(expectedReady.subarray(0, 6)) && status[6] === 8 && status.subarray(7, 39).equals(expectedReady.subarray(7, 39));
      if (!headerOk) { sock.destroy(); return finish('the Host status record was not for this exchange'); }
      if (status[41 + 4] !== 2) { out.stage = 'withheld'; sock.destroy(); return finish('the Host reports it is not accepting protected operations; the request was withheld'); }
      out.sent = true;
      arm(req.responseTimeoutMs, 'the Host did not answer in time');
      sock.write(Buffer.from(req.request, 'hex'));
    }
    const answerAt = req.readyLen + req.statusLen;
    if (out.sent && buf.length >= answerAt + req.responseLen) {
      if (buf.length > answerAt + req.responseLen) { sock.destroy(); return finish('the Host sent more than one response frame'); }
      out.response = buf.subarray(answerAt).toString('hex');
      clearTimeout(timer);
      sock.end();
      finish('answered');
    }
  });
});
`;
