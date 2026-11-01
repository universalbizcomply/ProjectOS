// SPDX-License-Identifier: MIT
// Ported-From: oh-my-hermes https://github.com/rlaope/oh-my-hermes
// Source-Path: src/plugin_bundle/omh/memory_admission.py; src/plugin_bundle/omh/memory_recall_support.py
// Source-Commit: 612a1cd9c44a19ecddcd263865e40e8c3910a514
// Source-Copyright: Copyright (c) 2026 oh-my-hermes contributors
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python to TypeScript; the instruction screen covers every author and has no record-type exemption; auto-approval removed, so a relative-time phrase is shown to the reviewer rather than used to hold a capture
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * What may be admitted to memory at all, before anyone reviews it.
 *
 * Upstream's "memory admission" is the one path from a stated fact to a stored record. Three of its
 * rules are kept:
 *
 *  - An order to the reader is refused. Memory replays into later sessions, so a summary written as a
 *    command would come back carrying a user turn's weight.
 *  - The duplicate key is exact: never similarity, so it cannot merge two facts that merely look alike.
 *  - A relative-time phrase is named. "Tomorrow" has an anchor the stored text does not hold.
 *
 * WHERE THIS DEPARTS FROM UPSTREAM, BECAUSE OF THE OWNER'S RULE. Upstream defaults to auto-approving a
 * safe capture and screens only the model's own path. Here nothing auto-approves, and the screen covers
 * every author. It takes no role on purpose: a role is only what a caller says it is until owner proof
 * exists, so a role that skipped the screen would be a bypass anyone could claim. Upstream exempts the
 * `procedure` record type too; that label is the proposer's own, and the exemption is gone for the same
 * reason. An owner who wants an instruction remembered states it as what holds.
 */
import { memoryOk, memoryRefused, type MemoryResult } from './refusal.js';
import { firstThreat } from './threatScan.js';

/** Second-person modal phrases, matched as consecutive words inside one clause. */
const SECOND_PERSON_PHRASES: readonly (readonly string[])[] = [
  ['you', 'must'],
  ['you', 'should'],
  ['you', 'need', 'to'],
  ['you', 'have', 'to'],
  ['you', 'ought', 'to'],
];
const CLAUSE_BOUNDARY = /[.,;:!?。，、；：！？]+/;
const KOREAN_REQUEST_ENDINGS = ['해줘', '해 줘', '해주세요', '해 주세요', '하세요', '해라', '하십시오'];
const KOREAN_REQUEST = new RegExp(`(${KOREAN_REQUEST_ENDINGS.join('|')})`, 'gu');
const SENTENCE_END = new Set(['.', '!', '?', '。', '！', '？']);
/** Fixed greetings that end in a request ending and order nothing. */
const KOREAN_GREETINGS = ['안녕하세요', '수고하세요', '고생하세요'];
/** Invisible characters that would split a cue without changing how it reads. */
const ZERO_WIDTH = /[\u200b\u200c\u200d\ufeff]/g;
/** Emoji variation selectors and the keycap mark, which would otherwise end the closer run. */
const EMOJI_MARKS = new Set(['\ufe0e', '\ufe0f', '\u20e3']);
const KEYCAP = /[0-9#*]\ufe0f?\u20e3/gu;
const CLOSER = /^[\s\p{P}\p{S}]$/u;

function clauseHasPhrase(words: readonly string[], phrase: readonly string[]): boolean {
  return words.some((_, start) => phrase.every((word, offset) => words[start + offset] === word));
}

function koreanRequestCue(text: string): string {
  for (const match of text.matchAll(KOREAN_REQUEST)) {
    const end = match.index + match[0].length;
    if (KOREAN_GREETINGS.some((greeting) => text.slice(0, end).endsWith(greeting))) continue;
    const rest = [...text.slice(end).replace(KEYCAP, '')];
    const firstOther = rest.findIndex((character) => !EMOJI_MARKS.has(character) && !CLOSER.test(character));
    const closers = firstOther < 0 ? rest : rest.slice(0, firstOther);
    if (firstOther < 0 || closers.some((character) => SENTENCE_END.has(character))) return match[0];
  }
  return '';
}

/** The cue that makes a text read as an order to its reader, or "". */
export function instructionShapedCue(text: string): string {
  const folded = text.normalize('NFKC').replace(ZERO_WIDTH, '');
  for (const clause of folded.toLowerCase().split(CLAUSE_BOUNDARY)) {
    const words = clause.match(/[a-z']+/g) ?? [];
    const phrase = SECOND_PERSON_PHRASES.find((candidate) => clauseHasPhrase(words, candidate));
    if (phrase !== undefined) return phrase.join(' ');
  }
  return koreanRequestCue(folded);
}

const EN_QUANTITY = String.raw`(?:\d{1,4}|an?|one|two|three|four|five|six|seven|eight|nine|ten|(?:a\s+)?few|several|(?:a\s+)?couple(?:\s+of)?)`;
const EN_TIME_UNIT = String.raw`(?:days?|weeks?|months?|years?|hours?|minutes?)`;
const EN_WEEKDAY = String.raw`(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)`;
const FR_QUANTITY = String.raw`(?:\d{1,4}|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|quelques|plusieurs)`;
const FR_TIME_UNIT = String.raw`(?:jours?|semaines?|mois|ann[ée]es?|ans?|heures?|minutes?)`;
const FR_WEEKDAY = String.raw`(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)`;

const RELATIVE_TIME = new RegExp(
  [
    String.raw`(?<!\d)\d{1,4}\s*(?:일|주|개월|달|년|시간|분)\s*(?:뒤|후|이내|안에|내로)`,
    String.raw`(?<![가-힣])(?:그저께|어제|오늘|내일|모레|다음\s*주|다음\s*달|이번\s*주)(?:은|는|이|가|에|에는|부터|까지|도|만)?(?![가-힣])`,
    String.raw`\b(?:yesterday|today|tomorrow|next\s+(?:week|month|year)|in\s+(?!(?:an?|one)\s+(?!few\b|couple\b))${EN_QUANTITY}\s+${EN_TIME_UNIT}|${EN_QUANTITY}\s+${EN_TIME_UNIT}\s+ago|last\s+(?:week|month|year)|the\s+other\s+day|(?<!\bthe\s)(?:last|next)\s+${EN_WEEKDAY}(?!\s+(?:of|in)\b)|(?<!\bmost\s)(?<!\bleast\s)recently)\b`,
    String.raw`(?<!\d)\d{1,4}\s*(?:日|週間|ヶ月|か月|年)\s*(?:後|以内)`,
    String.raw`(?<!\d)\d{1,4}\s*(?:天|周|個月|个月|年)\s*(?:后|後|以内|以內|内|內)`,
    String.raw`明日|昨日|来週|来月|明天|昨天|下周(?!期)|下個月|下个月`,
    String.raw`\b(?:(?:dans|d['’]ici)\s+${FR_QUANTITY}\s+${FR_TIME_UNIT}|(?:la\s+)?semaine\s+prochaine|(?:le\s+)?mois\s+prochain|(?:l['’])?ann[ée]e\s+prochaine|demain|aujourd['’]hui|avant-hier|il\s+y\s+a\s+${FR_QUANTITY}\s+${FR_TIME_UNIT}|${FR_WEEKDAY}\s+(?:dernier|prochain)|(?<!\bplus\s)(?<!\bmoins\s)r[ée]cemment|(?:la\s+)?semaine\s+derni[èe]re|(?:le\s+)?mois\s+dernier|(?:l['’])?ann[ée]e\s+derni[èe]re|l['’]an\s+dernier|d['’]ici\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|la\s+fin\s+(?:de\s+la\s+semaine|du\s+mois)))\b`,
  ].join('|'),
  'iu',
);

/** The first relative-time phrase in stored text, or "". */
export function relativeTimePhrase(text: string): string {
  return RELATIVE_TIME.exec(text)?.[0] ?? '';
}

/** NFC, lower case, collapsed whitespace: one identity for "the same text". */
export function normalizedEntryKey(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part !== '')
    .join(' ');
}

/** The replacement character: what a lossy read leaves behind, so it never counts as text. */
const LOSSY = '\ufffd';

/**
 * Whether this content may be proposed at all.
 *
 * Run at proposal AND again at approval, because the rules can change between the two and a proposal
 * file is only a file. Nothing here depends on who wrote the text.
 */
export function admitMemoryContent(content: string): MemoryResult<string> {
  if (content.trim() === '') return memoryRefused('MEMORY_EMPTY', 'Content cannot be empty.');
  if (content.includes(LOSSY)) {
    return memoryRefused('MEMORY_LOSSY_TEXT', 'Content holds a replacement character, so it was not read intact.');
  }
  const threat = firstThreat(content, 'strict');
  if (threat !== null) return memoryRefused('MEMORY_THREAT', threat.message, threat.pattern);
  const cue = instructionShapedCue(content);
  if (cue !== '') {
    return memoryRefused(
      'MEMORY_INSTRUCTION_SHAPED',
      `Nothing was proposed: this reads as an order to its reader ('${cue}'). Restate it as what holds, not as a command.`,
      cue,
    );
  }
  return memoryOk(content);
}
