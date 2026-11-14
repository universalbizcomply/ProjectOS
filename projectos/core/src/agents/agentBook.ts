// Origin: original ProjectOS code
/**
 * The agents a tenant's project holds, keyed by tenant, project and agent id, never by an agent id alone.
 *
 * A BOOK IS DATA, AND IT NEVER EVICTS. Adding an agent returns a new book and leaves the old one as it was. A second record
 * for an agent already in the scope is refused, not an overwrite, so a later record cannot quietly change what an agent may
 * hold. At the cap for a project a record is refused and nothing is dropped to make room. The number of projects is the tenant
 * registry's, so the book is bounded by it and by this cap.
 *
 * THE BOOK IS THIS MODULE'S. A value shaped like a book is not one: the records live in a private map keyed by the book this
 * module returned, and a lookup only returns a record the reader admitted. A caller cannot hand in a book it edited.
 *
 * Pure: no I/O.
 */
import { isAdmittedAgentRecord, type AgentRecord } from './agentRecord.js';
import { MAX_AGENTS_PER_PROJECT } from './delegationLimits.js';

/** An opaque book. Read it with `findAgent`. */
export interface AgentBook {
  readonly size: number;
}

/** One scope, written so no tenant, project or agent id can run into the next. */
export const scopeKey = (tenant: string, project: string): string => JSON.stringify([tenant, project]);
const agentKey = (tenant: string, project: string, agentId: string): string => JSON.stringify([tenant, project, agentId]);

const BOOKS = new WeakMap<AgentBook, ReadonlyMap<string, AgentRecord>>();

function bookOf(records: ReadonlyMap<string, AgentRecord>): AgentBook {
  const book: AgentBook = Object.freeze({ size: records.size });
  BOOKS.set(book, records);
  return book;
}

export const emptyAgentBook = (): AgentBook => bookOf(new Map());

/** Did this module build the book? */
export const isAgentBook = (value: unknown): value is AgentBook => typeof value === 'object' && value !== null && BOOKS.has(value as AgentBook);

export type AddAgentCode = 'BOOK' | 'AGENT_NOT_ADMITTED' | 'AGENT_DUPLICATE' | 'BOOK_FULL';

export type AddAgentResult =
  | { readonly ok: true; readonly book: AgentBook }
  | { readonly ok: false; readonly code: AddAgentCode; readonly message: string };

export function addAgent(book: AgentBook, record: AgentRecord): AddAgentResult {
  const held = BOOKS.get(book);
  if (held === undefined) return { ok: false, code: 'BOOK', message: 'this book was not built by this module' };
  if (!isAdmittedAgentRecord(record)) return { ok: false, code: 'AGENT_NOT_ADMITTED', message: 'only a record the reader admitted can be added' };
  const key = agentKey(record.tenant, record.project, record.agentId);
  if (held.has(key)) return { ok: false, code: 'AGENT_DUPLICATE', message: `'${record.agentId}' is already held in this tenant and project; a second record does not replace it` };
  const inProject = [...held.values()].filter((entry) => entry.tenant === record.tenant && entry.project === record.project).length;
  if (inProject >= MAX_AGENTS_PER_PROJECT) {
    return { ok: false, code: 'BOOK_FULL', message: 'the book is full for this project; nothing is dropped to make room' };
  }
  return { ok: true, book: bookOf(new Map([...held, [key, record]])) };
}

/** The agent in exactly this tenant and project, or `null`. Another tenant's agent of the same name is not found. */
export function findAgent(book: AgentBook, tenant: string, project: string, agentId: string): AgentRecord | null {
  const found = BOOKS.get(book)?.get(agentKey(tenant, project, agentId));
  return found !== undefined && isAdmittedAgentRecord(found) ? found : null;
}
