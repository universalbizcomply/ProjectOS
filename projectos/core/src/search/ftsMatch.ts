// Origin: original ProjectOS code
/**
 * THE ONE PLACE A QUERY BECOMES FTS5 SYNTAX.
 *
 * A query is words, never FTS5 syntax. Every term goes out as a double-quoted string with its quotes doubled, so
 * `NEAR`, `OR`, `*`, `^` and `column:` in what a person or a document typed are only words. The boolean
 * structure comes from the `TextQuery` tree alone. The string is then bound as a parameter, never spliced.
 *
 * Pure. An empty clause compiles to nothing rather than to a query that matches everything.
 */
import type { TextQuery } from './keywordQuery.js';

const quoted = (text: string): string => `"${text.replaceAll('"', '""')}"`;

export function compileFts5Match(query: TextQuery): string | null {
  if (query.kind === 'term') {
    // SQLite ends a string at NUL, so a term holding one would be cut short, not quoted.
    return query.text === '' || query.text.includes('\0') ? null : quoted(query.text);
  }
  const clauses = query.clauses.map(compileFts5Match).filter((clause): clause is string => clause !== null);
  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0] as string;
  return `(${clauses.join(query.kind === 'all' ? ' AND ' : ' OR ')})`;
}
