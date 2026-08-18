/**
 * The real HTTP edge for the gatekeeper transport — the one place ProjectOS talks to OpenAI.
 *
 * DELIBERATELY THE SMALLEST THING THAT WORKS. It performs one POST, applies a timeout, and returns
 * the status and body. It does not retry, does not follow redirects, does not parse, and does not
 * decide anything: every judgement about what came back belongs to `submitToOpenAi` and, after it, to
 * `checkGatekeeperDecision`. A transport that retried would quietly turn one governed request into
 * several, and the ledger would be counting something other than what happened.
 *
 * NOTHING HERE LOGS. Not the headers, not the body, not on failure. The Authorization header passes
 * through this function and is never inspected, copied, or included in the error it returns — a
 * transport error reports the ERROR, and an error message that quotes the request is how a key ends
 * up in a log file.
 *
 * WHY `undici`'s GLOBAL fetch AND NOT A CLIENT LIBRARY. A vendor SDK would bring its own retries, its
 * own environment-variable credential discovery and its own telemetry, each of which is a behaviour
 * this design has explicitly refused elsewhere. Node's built-in fetch has none of them.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */
import { spawnSync } from 'node:child_process';
import type { HttpPort, HttpResponse } from './openaiResponses.js';

/**
 * A synchronous port over an asynchronous call.
 *
 * THE AWKWARD PART, STATED PLAINLY. Every seam in this loop is synchronous — `System.exec`,
 * `runLoop`, the whole verification chain — because that is what made them testable without a
 * scheduler. One asynchronous call at the very edge does not justify converting all of it, so the
 * request is made in a child process and awaited there. The cost is a process spawn per governed
 * decision, which against a call that takes seconds and costs money is not worth optimising away.
 */
export function nodeHttpPort(): HttpPort {
  return {
    post(request): HttpResponse {
      // The request — including the Authorization header — is handed to the child on STDIN, never as
      // an argument. Command lines are visible to any process listing on the machine.
      const payload = JSON.stringify({
        url: request.url,
        headers: request.headers,
        body: request.body,
        timeoutMs: request.timeoutMs,
      });

      // `spawnSync` with an ARGUMENT ARRAY and no shell: nothing here is interpolated into a command
      // line, and the request travels on stdin.
      const result = spawnSync(process.execPath, ['-e', CHILD_SCRIPT], {
        input: payload,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      });
      if (result.error !== undefined || result.status !== 0) {
        // The child's stderr is a Node error, not a response body; it is reported without the request.
        return {
          kind: 'transport-error',
          detail: (result.stderr ?? '').trim().slice(0, 300) || 'the request process failed',
        };
      }
      try {
        const parsed = JSON.parse(result.stdout ?? '') as { status?: number; body?: string; error?: string };
        if (typeof parsed.error === 'string') return { kind: 'transport-error', detail: parsed.error.slice(0, 300) };
        if (typeof parsed.status !== 'number') return { kind: 'transport-error', detail: 'the request process returned no status' };
        return { kind: 'response', status: parsed.status, body: typeof parsed.body === 'string' ? parsed.body : '' };
      } catch {
        return { kind: 'transport-error', detail: 'the request process returned unreadable output' };
      }
    },
  };
}

/**
 * The child. Reads the request from stdin, writes `{status, body}` or `{error}` to stdout.
 *
 * It prints NOTHING else — no progress, no diagnostics — because its stdout is parsed and its parent
 * holds a credential in the object it was handed.
 */
const CHILD_SCRIPT = `
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', async () => {
  try {
    const req = JSON.parse(raw);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      const res = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
      const body = await res.text();
      process.stdout.write(JSON.stringify({ status: res.status, body }));
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    // The message only — never the request, which carries the Authorization header.
    process.stdout.write(JSON.stringify({ error: e && e.name === 'AbortError' ? 'the request timed out' : String(e && e.message || e) }));
  }
});
`;
