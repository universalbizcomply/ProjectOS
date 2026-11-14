// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/mcp/plugin-tools-handlers.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPTED
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: the direction is reversed: upstream builds a tool result to serve, and this reads a tool result received from a server, so nothing it holds is trusted; the MCP SDK schema parse is replaced by a closed reading of text and image blocks; an image is reduced to a note about the image and its bytes are never passed on; any other block type becomes text, so nothing arrives as typed content; upstream's two image spellings (data and mimeType, or a base64 source with media_type) are both read; the tool wrapping, hooks, approval mode, run ids and abort plumbing are removed; a result that is not an object, or has no content list, is written as text, as upstream does
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * A tool result received from an MCP server, as plain text blocks.
 *
 * Upstream's `toMcpContentBlock` turns whatever a tool returned into a block an MCP client can read: a value that
 * is not a record becomes text, an image is read under either of its two spellings, and a block of any other type
 * is parsed against the SDK's schema. Here the same reading runs the other way, on the output of a server nobody
 * vouches for. The output of this module is always text and a count: an image's bytes are not kept, and a block
 * type this module has not been told about is written out as text rather than passed on as a typed block. Pure.
 */
export type ToolContentBlock = { readonly type: 'text'; readonly text: string };

export interface ToolResult {
  readonly blocks: readonly ToolContentBlock[];
  readonly isError: boolean;
}

/** More blocks than this are dropped, so a result cannot make its reader do unbounded work. */
export const MAX_TOOL_BLOCKS = 100;

const MIME_TYPE = /^[a-z][a-z0-9.+-]{0,40}\/[a-z0-9][a-z0-9.+-]{0,60}$/;
const UNREADABLE = '[unreadable block]';

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
}

/** Text as a reader would see it: a string as it is, nothing as nothing, anything else written out. */
function coerceText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return UNREADABLE;
  }
}

const textBlock = (text: string): ToolContentBlock => ({ type: 'text', text });

function imageNote(mimeType: unknown, data: unknown): ToolContentBlock | null {
  if (typeof data !== 'string' || typeof mimeType !== 'string') return null;
  const mime = MIME_TYPE.test(mimeType) ? mimeType : 'unknown';
  return textBlock(`[image ${mime}, ${data.length} characters of data not shown]`);
}

export function toToolContentBlock(block: unknown): ToolContentBlock {
  const record = asRecord(block);
  if (record === null) return textBlock(coerceText(block));
  if (record['type'] === 'text' && typeof record['text'] === 'string') return textBlock(record['text']);
  if (record['type'] === 'image') {
    const direct = imageNote(record['mimeType'], record['data']);
    if (direct !== null) return direct;
    const source = asRecord(record['source']);
    if (source !== null && source['type'] === 'base64') {
      const nested = imageNote(source['media_type'], source['data']);
      if (nested !== null) return nested;
    }
  }
  return textBlock(coerceText(block));
}

export function toToolResult(raw: unknown): ToolResult {
  const record = asRecord(raw);
  const content = record !== null && Object.hasOwn(record, 'content') ? record['content'] : raw;
  const blocks = Array.isArray(content) ? (content as readonly unknown[]).slice(0, MAX_TOOL_BLOCKS).map(toToolContentBlock) : [textBlock(coerceText(content))];
  return { blocks, isError: record?.['isError'] === true };
}
