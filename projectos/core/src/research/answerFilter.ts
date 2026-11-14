// Origin: original ProjectOS code
/**
 * The answer text is filtered before it leaves the loop (PROJECTOS-PORT-RESEARCH1A, fix round).
 *
 * The answer is up to 20,000 characters written by a model that has read untrusted pages. Rendered as markdown or HTML it can
 * load an image from an attacker's server with the question in its address, or offer a link that does the same on a click.
 * So every address in it that is not one of this run's cited sources is defanged to `[link removed]`:
 *   - HTML tags, comments and autolinks (`<img ...>`, `<a ...>`, `<https://...>`) are removed;
 *   - markdown images are removed, and markdown links keep their words and lose the address;
 *   - raw addresses with a scheme, `www.` addresses and `javascript:`, `data:` and `vbscript:` text are removed.
 * A cited source's own address is kept only EXACTLY as the run fetched it: with a query, a fragment or another character on
 * the end it is a different address and is removed.
 *
 * THE RENDERING RULE THE UI MUST FOLLOW. The answer is PLAIN TEXT. It is shown as text, never parsed as markdown or HTML, and
 * never turned into links by the UI. The filter is a second line, not a licence to render: a client that renders markdown
 * would still show an address that survives here, and the only survivors are the run's own cited sources.
 *
 * Every pattern is bounded, so hostile text costs time in proportion to its length.
 */

export const LINK_REMOVED = '[link removed]';

export interface FilteredAnswer {
  readonly text: string;
  /** How many spans were removed or defanged. */
  readonly removed: number;
}

const AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]{1,30}:[^<>\s]{0,2048}>/g;
const TAG = /<[/!?]?[A-Za-z!-][^<>]{0,2048}>/g;
const IMAGE = /!\[[^\]\n]{0,500}\]\([^)\n]{0,2048}\)/g;
const LINK = /\[([^\]\n]{0,500})\]\(([^)\n]{0,2048})\)/g;
const RAW = /(?:[A-Za-z][A-Za-z0-9+.-]{1,30}:\/\/|www\.)[^\s<>"'`)\]]{0,2048}|\b(?:javascript|data|vbscript):[^\s<>"'`)\]]{0,2048}/gi;

/** Trailing punctuation belongs to the sentence, not the address. */
const split = (match: string): readonly [string, string] => {
  const trimmed = match.replace(/[.,;:!?]+$/, '');
  return [trimmed, match.slice(trimmed.length)];
};

export function filterAnswerText(text: string, citedUrls: readonly string[]): FilteredAnswer {
  const cited = new Set(citedUrls);
  let removed = 0;
  const drop = (): string => {
    removed += 1;
    return LINK_REMOVED;
  };
  let out = text.replace(AUTOLINK, (whole) => (cited.has(whole.slice(1, -1)) ? whole : drop()));
  out = out.replace(TAG, () => {
    removed += 1;
    return '';
  });
  out = out.replace(IMAGE, drop);
  out = out.replace(LINK, (whole, words: string, target: string) => (cited.has(target.trim()) ? whole : `${words} ${drop()}`));
  out = out.replace(RAW, (match) => {
    const [address, tail] = split(match);
    return cited.has(address) ? match : `${drop()}${tail}`;
  });
  return { text: out, removed };
}
