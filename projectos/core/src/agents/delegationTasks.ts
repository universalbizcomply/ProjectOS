// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/delegate_tool_tasks.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: translated from Python to TypeScript; only the goal check is taken (a placeholder goal and an unfilled template marker are refused); the JSON string recovery, the batch count check (a delegation here is one child at a time, capped by the fan-out rule), the output schema and the image handling are cut; a goal that is not text or is past a named length is refused
// Notice: full licence text in THIRD_PARTY_NOTICES

import { MAX_GOAL_CHARS } from './delegationLimits.js';

// Placeholder shapes for goal validation: bare 'TODO' / 'task N' labels, or unexpanded template markers. The marker regex is
// deliberately NARROW: only snake_case / space-separated placeholder identifiers (`<feature_name>`, `{file path}`,
// `<FEATURE-NAME>`), the shape LLM templates leave behind. Bare single-word brackets must never be rejected: legitimate goals
// are full of generics (`Vec<T>`), HTML tags (`<div>`), dict snippets (`{"key": 1}`), glob braces (`{a,b}`) and f-string
// style (`{i}`).
const PLACEHOLDER_GOAL = /^(todo|task\s*\d+)$/i;
const TEMPLATE_MARKER = /<[A-Za-z][A-Za-z0-9]*(?:[ _-][A-Za-z0-9]+)+>|\{[A-Za-z][A-Za-z0-9]*(?:[ _-][A-Za-z0-9]+)+\}/;

/** Why this goal cannot be given to a delegate, or `null` when it is a real task. */
export function goalProblem(goal: unknown): string | null {
  if (typeof goal !== 'string') return 'the goal is not text';
  if (goal.length > MAX_GOAL_CHARS) return `the goal is past ${MAX_GOAL_CHARS} characters`;
  const text = goal.trim();
  if (text === '') return 'the goal is empty';
  if (PLACEHOLDER_GOAL.test(text.toLowerCase().split(/\s+/).join(' '))) return `the goal is a placeholder (${JSON.stringify(text)}); describe what the delegate should do`;
  const marker = TEMPLATE_MARKER.exec(text);
  if (marker !== null) return `the goal has an unexpanded template marker (${JSON.stringify(marker[0])}); a delegate cannot resolve placeholders`;
  return null;
}
