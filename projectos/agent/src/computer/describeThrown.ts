// Origin: original ProjectOS code
/**
 * What a port threw, described without ever throwing itself.
 *
 * A PORT'S FAILURE IS UNTRUSTED TEXT, AND READING IT MUST NOT FAIL. A spawn port, a signal or a timer can throw anything: a string,
 * a number, a symbol, a null-prototype object, an object whose `message` is a getter that throws or whose `toString` throws.
 * `String(error)` on such a value throws inside the runner and turns a start that may have acted into a rejected promise, which a
 * caller reads as "nothing happened". So there is one reader, `describeThrown`, and the runner and the kill executor use no other:
 * it looks at the type first, never calls a method a port supplied, takes a `message` only if it is a string, wraps the whole read
 * in a `try`, cuts the text to a fixed length, and returns it fenced as untrusted data by the core module.
 *
 * Nothing here starts a process, reads a clock or holds state.
 */
import { fenceUntrustedOutput, type FencedOutput } from '@projectos/core';

/** The most of a thrown value's text that is kept. */
export const MAX_START_ERROR_CHARS = 512;

function textOf(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'undefined':
      return String(value);
    case 'symbol':
      return 'a symbol was thrown';
    case 'function':
      return 'a function was thrown';
    default: {
      if (value === null) return 'null was thrown';
      const message = (value as { readonly message?: unknown }).message;
      return typeof message === 'string' ? message : 'an object was thrown';
    }
  }
}

/** A bounded, fenced description of anything that was thrown. It never throws. */
export function describeThrown(value: unknown): FencedOutput {
  let text: string;
  try {
    text = textOf(value);
  } catch {
    text = 'an unreadable value was thrown';
  }
  return fenceUntrustedOutput('stderr', text.slice(0, MAX_START_ERROR_CHARS));
}
