// Origin: original ProjectOS code
/**
 * How research text reaches a prompt, and how a page becomes something an answer can cite (PROJECTOS-PORT-RESEARCH1A).
 *
 * A FETCHED PAGE REACHES A PROMPT ONLY HERE, and only fenced. Each line is shown with its number, so a model can cite
 * `web/<host>/<hash>` lines 3 to 9, and those numbers are ours: a page line that spells `7| ...` is still one line of
 * data with our own prefix in front of it. The fence id is derived from what the fence holds (`externalContent.ts`),
 * so the page cannot close it.
 *
 * A PAGE IS CITED THROUGH THE SEARCH MODULE'S DOOR. `hitOfPage` makes a `CitedSearchHit` with `admitSearchResult`, in the
 * run's own project, and the answer is judged by `admitCitedAnswer`: the same refusals document search has, so a
 * citation of a page that was not fetched, or of lines it does not have, is refused by code that already exists.
 */

import { scanForThreats } from '../memory/threatScan.js';
import { admitSearchResult, type SearchResultAdmission } from '../search/citation.js';
import { stripInvisibleUnicode } from './readableText.js';
import { wrapExternalContent } from './externalContent.js';
import type { FetchedPage } from './webFetch.js';
import type { SearchResult } from './searchProvider.js';

/** A header value with its invisible characters stripped, or `[removed]` when it matches the threat scan. The header is outside the numbered text. */
const labelOf = (value: string): string => {
  const clean = stripInvisibleUnicode(value);
  return scanForThreats(clean, 'context').length > 0 ? '[removed]' : clean;
};

/** The page text, one numbered line at a time, inside the untrusted fence. */
export function renderResearchEvidence(page: FetchedPage): string {
  const numbered = page.text
    .split('\n')
    .map((line, index) => `${index + 1}| ${line}`)
    .join('\n');
  return wrapExternalContent(numbered, {
    source: 'web_fetch',
    labels: [
      ['Citation', page.sourcePath],
      ['Lines', `1-${page.lineCount}`],
      ['URL', labelOf(page.finalUrl)],
      ...(page.title === undefined ? [] : ([['Title', labelOf(page.title)]] as const)),
    ],
  });
}

/** Search results as the planner sees them: each one fenced as untrusted, with no boundary note repeated. */
export function renderSearchResults(provider: string, results: readonly SearchResult[]): readonly string[] {
  return results.map((result, index) =>
    wrapExternalContent(`${result.title}\n${result.url}\n${result.snippet}`, { source: 'web_search', includeWarning: false, labels: [['Provider', provider], ['Result', String(index + 1)]] }),
  );
}

/** The page as a retrieved hit in `project`, covering every line it has. A page whose path cannot be a citation is refused. */
export function hitOfPage(page: FetchedPage, project: string): SearchResultAdmission {
  return admitSearchResult(
    { project, path: page.sourcePath, startLine: 1, endLine: page.lineCount, score: 1, vectorScore: 0, textScore: 1, snippet: page.text, source: 'documents' },
    project,
  );
}
