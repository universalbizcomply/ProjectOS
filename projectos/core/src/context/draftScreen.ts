// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: agent/context_compressor.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-02: modified for ProjectOS. CHANGED: translated from Python to TypeScript; the prose refusal test only, widened to a bare refusal that never mentions a summary, without the provider refusal field and without the length-stop guard upstream marks as ported from elsewhere; the memory admission rule, a credential screen and a broken-surrogate screen added
// Modified-By: ProjectOS 2026-11-02: modified for ProjectOS. CHANGED: a bare first-person refusal needs no subject; a draft too short to summarise anything is refused
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * What may stand as a summary.
 *
 * A model can answer "I'm sorry, I can't help" with a clean stop, and that text is not empty, so without this
 * it would be installed and the turns it replaced would be gone. The test is narrow, as upstream's is: a real
 * summary may record a refusal, and one opening with a hedge carries headings. Everything else is the memory
 * admission rule, because a summary replays into later turns as memory does.
 *
 * It runs on a draft and again whenever a thread is read, so a summary that reached a thread some other way
 * meets the same screen. Pure.
 */
import { admitMemoryContent } from '../memory/admission.js';
import { foldMemoryLines } from '../memory/store.js';
import { holdsSecretShape } from './redact.js';
import { contextRefused, type ContextRefused } from './refusal.js';

const MODEL_REFUSAL =
  /^\s*(?:(?:sorry|i(?:['\u2019]m| am)\s+sorry|i\s+apologi[sz]e|as\s+an\s+ai)\s*[,;:]?\s*(?:but\s+)?)?(?:i|we)\s+(?:can(?:\s*not|['\u2019]t)|could\s*not|couldn['\u2019]t|won['\u2019]t|will\s+not|must\s+decline|refuse\s+to|am\s+unable\s+to|am\s+not\s+able\s+to)\b|^\s*(?:i['\u2019]?m|i\s+am)\s+(?:unable|not\s+able)\b/i;
const REFUSAL_SUBJECT = /summar|checkpoint|help|assist|comply|request|conversation/i;
const HEADING = /^##\s/m;
const OPENER_CHARS = 400;
/** "I cannot do that." names no subject and says nothing else. A longer first-person sentence may be an account. */
const FIRST_PERSON = /^(?:sorry|as an ai|i\b)/i;
const BARE_REFUSAL_CHARS = 40;
/** Fewer visible characters than this cannot stand in for the turns it would replace. */
const MIN_SUMMARY_CHARS = 20;
const LONE_SURROGATE = /\p{Cs}/u;
const EMOJI_VARIATION = /\ufe0f/gu;

function isModelRefusal(text: string): boolean {
  const flat = text.split(/\s+/).join(' ');
  if (!MODEL_REFUSAL.test(flat) || HEADING.test(text)) return false;
  const bare = FIRST_PERSON.test(flat.trim()) && flat.trim().length <= BARE_REFUSAL_CHARS;
  return bare || REFUSAL_SUBJECT.test(flat.slice(0, OPENER_CHARS));
}

/** A draft as it will be held: Windows line endings folded, and the emoji mark that is not text gone. */
export function cleanDraftText(text: string): string {
  return foldMemoryLines(text).replace(EMOJI_VARIATION, '');
}

/** Why this text may not stand as a summary, or nothing. */
export function summaryTextProblem(text: string): ContextRefused | null {
  const refuse = (why: string, named: string): ContextRefused => contextRefused('CONTEXT_SUMMARY_REFUSED', why, named);
  if (LONE_SURROGATE.test(text)) return refuse('That text holds a broken character, so it was not read intact.', 'lone_surrogate');
  if (isModelRefusal(text)) return refuse('That is a refusal, not a summary. The turns stay.', 'model_refusal');
  if (text.replace(/\s/g, '').length < MIN_SUMMARY_CHARS) return refuse('That is too short to stand in for the turns it would replace. The turns stay.', 'empty_summary');
  if (holdsSecretShape(text)) return refuse('That text holds the shape of a credential, and a summary replays into every later turn.', 'credential_shape');
  const admitted = admitMemoryContent(text);
  return admitted.ok ? null : contextRefused('CONTEXT_SUMMARY_REFUSED', admitted.refusal.message, admitted.refusal.named);
}
