// Origin: original ProjectOS code
/**
 * The answer text is filtered before it leaves the loop (PROJECTOS-PORT-RESEARCH1A, fix rounds 1 and 2).
 *
 * THIS FILTER IS DEFENCE IN DEPTH, AND IT IS NOT SUFFICIENT ON ITS OWN. THE UI MUST RENDER A RESEARCH ANSWER AS PLAIN TEXT:
 * shown as text, never parsed as markdown or HTML, never turned into links, and never allowed to load an image, a frame or a
 * style. A client that renders markdown or HTML is exposed to every form of an address that the filter fails to recognise,
 * and no filter can be proved to recognise them all.
 *
 * The answer is up to 20,000 characters written by a model that has read untrusted pages. Rendered as markdown or HTML it can
 * load an image from an attacker's server with the question in its address, or offer a link that does the same on a click. So
 * every address in it that is not one of this run's cited sources is defanged to `[link removed]`:
 *   - ENTITIES ARE DECODED FIRST (named, decimal and hexadecimal, and again for every layer of encoding), so `https&#58;//`,
 *     `&colon;` and `&amp;#58;` are the address they spell before anything looks for one;
 *   - HTML comments, declarations and autolinks are removed, and so are real HTML TAGS, by an allow-list of tag names, so
 *     `Map<String, Integer>` and `a < b > c` are left alone. A tag that has no attributes and is capitalised like a type
 *     (`<Object>`, `<Map>`) is left alone too;
 *   - markdown images and links are removed or keep their words, and so are reference-style images and links and reference
 *     definitions (`[1]: //host/path`);
 *   - raw addresses are removed: with a scheme, with `www.`, scheme-relative (`//host.tld/...`), bare with a path or a query
 *     (`host.tld/path?d=...`), and `javascript:`, `data:` and `vbscript:` followed by a letter or a slash.
 * A cited source's own address is kept only EXACTLY as the run fetched it, with or without its scheme: with a query, a fragment
 * or another character on the end it is a different address and is removed.
 *
 * IT RUNS TO A FIXPOINT. One pass can assemble what the next must remove (`<<b>img src=...>` becomes a live `<img ...>` when the
 * inner tag goes), so the pass repeats until the text stops changing. There is a cap of `MAX_FILTER_PASSES`. Text that is still
 * changing at the cap, which is deeper encoding than any honest answer has, is NOT returned: `stable` is false and the text is
 * replaced by the marker, and the loop refuses the answer.
 *
 * WHAT IT CHANGES THAT IS NOT AN ADDRESS. Entities are decoded, so `&amp;` is shown as `&`. That is deliberate: the answer is
 * plain text, and the decoded form is what a renderer would have shown.
 *
 * Every pattern is bounded, so hostile text costs time in proportion to its length.
 */

export const LINK_REMOVED = '[link removed]';
export const MAX_FILTER_PASSES = 8;

export interface FilteredAnswer {
  readonly text: string;
  /** How many spans were removed or defanged. */
  readonly removed: number;
  /** False when the text was still changing at the pass cap. The text is then the marker, and the answer is to be refused. */
  readonly stable: boolean;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', sol: '/', bsol: '\\', period: '.', comma: ',', excl: '!', quest: '?', equals: '=', commat: '@', num: '#',
  percnt: '%', lpar: '(', rpar: ')', lsqb: '[', rsqb: ']', lbrack: '[', rbrack: ']', semi: ';', plus: '+', ast: '*', lowbar: '_', grave: '`', lcub: '{', rcub: '}', verbar: '|', tab: ' ', newline: '\n',
};

/** Real HTML tag names. A name that is not here is not a tag, so a type argument or an inequality survives. */
const TAG_NAMES: readonly string[] = [
  'a', 'abbr', 'acronym', 'address', 'applet', 'area', 'article', 'aside', 'audio', 'b', 'base', 'basefont', 'bdi', 'bdo', 'blink', 'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'center', 'cite',
  'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'dir', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'font', 'footer', 'form', 'frame',
  'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'marquee',
  'math', 'menu', 'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output', 'p', 'param', 'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'section',
  'select', 'slot', 'small', 'source', 'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup', 'svg', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr',
  'track', 'tt', 'u', 'ul', 'var', 'video', 'wbr',
];

/** Tag names a programmer writes as a type, `<Object>` or `<Map>`. Capitalised and bare, they are left alone. */
const TYPE_LIKE: ReadonlySet<string> = new Set(['object', 'map', 'data', 'time', 'template', 'option', 'select', 'source', 'style', 'title', 'param', 'meter', 'output', 'label', 'menu', 'section', 'var', 'code', 'link', 'input', 'form', 'slot', 'font', 'frame', 'base', 'main', 'header', 'footer', 'article', 'summary', 'details', 'dialog', 'table', 'canvas', 'embed', 'math']);

const REST = String.raw`[^\s<>"'\x60)\]]`;
const COMMENT = /<!--[\s\S]{0,4096}?-->/g;
const DECLARATION = /<[!?][^<>]{0,2048}>/g;
const AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]{1,30}:[^<>\s]{0,2048}>/g;
const TAG = new RegExp(String.raw`<\/?(${TAG_NAMES.join('|')})(?=[\s/>])[^<>]{0,2048}>`, 'gi');
const IMAGE = /!\[[^\]\n]{0,500}\]\([^)\n]{0,2048}\)/g;
const IMAGE_REF = /!\[[^\]\n]{0,500}\]\[[^\]\n]{0,100}\]/g;
const LINK = /\[([^\]\n]{0,500})\]\(([^)\n]{0,2048})\)/g;
const LINK_REF = /\[([^\]\n]{0,500})\]\[[^\]\n]{0,100}\]/g;
const REFERENCE_DEFINITION = /^[ \t]{0,3}\[[^\]\n]{1,100}\]:[ \t]*(\S{1,2048})[^\n]{0,500}$/gm;
const SCHEME_ADDRESS = new RegExp(String.raw`[A-Za-z][A-Za-z0-9+.-]{1,30}:\/\/${REST}{0,2048}`, 'g');
const WWW_ADDRESS = new RegExp(String.raw`\bwww\.${REST}{1,2048}`, 'gi');
const SCHEME_RELATIVE = new RegExp(String.raw`(?<![:\w/.])\/\/[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}${REST}{0,2048}`, 'g');
const BARE_ADDRESS = new RegExp(String.raw`(?<![A-Za-z0-9@./-])(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}(?::\d{1,5})?[/?#]${REST}{0,2048}`, 'g');
const SCRIPT_SCHEME = new RegExp(String.raw`\b(?:javascript|data|vbscript):(?=[A-Za-z/])${REST}{1,2048}`, 'gi');

function decode(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(?:#(\d{1,7});?|#[xX]([0-9a-fA-F]{1,6});?|([A-Za-z]{2,8});)/g, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name !== undefined) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = dec !== undefined ? Number(dec) : Number.parseInt(hex as string, 16);
    return code >= 1 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
  });
}

/** Trailing punctuation belongs to the sentence, not the address. */
const split = (match: string): readonly [string, string] => {
  const trimmed = match.replace(/[.,;:!?]+$/, '');
  return [trimmed, match.slice(trimmed.length)];
};

/** One pass of every filter, in order, on text that has already been decoded. */
function pass(input: string, cited: ReadonlySet<string>, bare: ReadonlySet<string>): { readonly text: string; readonly removed: number } {
  let removed = 0;
  const drop = (): string => {
    removed += 1;
    return LINK_REMOVED;
  };
  const gone = (): string => {
    removed += 1;
    return '';
  };
  const address = (match: string, kept: ReadonlySet<string>): string => {
    const [trimmed, tail] = split(match);
    return kept.has(trimmed) ? match : `${drop()}${tail}`;
  };
  let out = input.replace(COMMENT, gone).replace(DECLARATION, gone);
  out = out.replace(AUTOLINK, (whole) => (cited.has(whole.slice(1, -1)) ? whole : drop()));
  out = out.replace(TAG, (whole, name: string) => (TYPE_LIKE.has(name.toLowerCase()) && /^<[A-Z][a-z]*>$/.test(whole) ? whole : gone()));
  out = out.replace(IMAGE, drop).replace(IMAGE_REF, drop);
  out = out.replace(LINK, (whole, words: string, target: string) => (cited.has(target.trim()) ? whole : `${words} ${drop()}`));
  out = out.replace(LINK_REF, (_whole, words: string) => `${words} ${drop()}`);
  out = out.replace(REFERENCE_DEFINITION, (whole, target: string) => (cited.has(target) ? whole : drop()));
  out = out.replace(SCHEME_ADDRESS, (match) => address(match, cited));
  out = out.replace(WWW_ADDRESS, (match) => address(match, cited));
  out = out.replace(SCHEME_RELATIVE, drop);
  out = out.replace(BARE_ADDRESS, (match) => address(match, bare));
  out = out.replace(SCRIPT_SCHEME, drop);
  return { text: out, removed };
}

export function filterAnswerText(text: string, citedUrls: readonly string[]): FilteredAnswer {
  const cited = new Set(citedUrls);
  const bare = new Set(citedUrls.map((url) => url.replace(/^https?:\/\//i, '')));
  let current = text;
  let removed = 0;
  for (let round = 0; round < MAX_FILTER_PASSES; round += 1) {
    const next = pass(decode(current), cited, bare);
    removed += next.removed;
    if (next.text === current) return { text: current, removed, stable: true };
    current = next.text;
  }
  return { text: LINK_REMOVED, removed, stable: false };
}
