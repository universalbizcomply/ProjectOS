// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/delegate_tool_toolsets.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: translated from Python to TypeScript; the blocked-tool list is taken as it is, but the source subtracts it from a toolset the child inherits and silently drops a toolset the parent lacks, while here a child states its grants as an allowlist and a grant the parent lacks, a blocked grant or a grant the child's own record does not hold is refused by name; the composite toolset expansion, the MCP toolset inheritance and the orchestrator role that re-adds delegation are cut
// Notice: full licence text in THIRD_PARTY_NOTICES

import { GRANT_NAME } from './agentRecord.js';
import { MAX_AGENT_GRANTS } from './delegationLimits.js';

// Tools that children must never have access to
export const DELEGATE_BLOCKED_GRANTS: readonly string[] = Object.freeze([
  'delegate_task', // no recursive delegation
  'clarify', // no user interaction
  'memory', // no writes to shared MEMORY.md
  'send_message', // no cross-platform side effects
  'cronjob_manage', // no scheduling more work in the parent's name
]);

export type GrantRefusalCode = 'GRANT_SHAPE' | 'GRANT_BLOCKED' | 'GRANT_EXCEEDS_PARENT' | 'GRANT_NOT_ON_RECORD';

export interface GrantRefusal {
  readonly code: GrantRefusalCode;
  readonly message: string;
}

/**
 * Why a child may not hold exactly these grants, or `null` when it may. Children never gain a tool the parent lacks: the
 * source intersects the request with the parent's toolsets and drops the rest without a word, and a request for more than
 * the parent holds is refused here instead. The checks run in a fixed order, so the refusal names the first rule broken.
 */
export function childGrantProblem(parentGrants: readonly string[], childRecordGrants: readonly string[], requested: unknown): GrantRefusal | null {
  if (
    !Array.isArray(requested) ||
    requested.length > MAX_AGENT_GRANTS ||
    !(requested as readonly unknown[]).every((grant, index, all) => typeof grant === 'string' && GRANT_NAME.test(grant) && all.indexOf(grant) === index)
  ) {
    return { code: 'GRANT_SHAPE', message: `grants must be a list of at most ${MAX_AGENT_GRANTS} different tool words, with no wildcard` };
  }
  const grants = requested as readonly string[];
  const blocked = grants.find((grant) => DELEGATE_BLOCKED_GRANTS.includes(grant));
  if (blocked !== undefined) return { code: 'GRANT_BLOCKED', message: `'${blocked}' is never given to a delegate` };
  const beyondParent = grants.find((grant) => !parentGrants.includes(grant));
  if (beyondParent !== undefined) return { code: 'GRANT_EXCEEDS_PARENT', message: `'${beyondParent}' is not held by the parent, so the child cannot hold it` };
  const beyondRecord = grants.find((grant) => !childRecordGrants.includes(grant));
  if (beyondRecord !== undefined) return { code: 'GRANT_NOT_ON_RECORD', message: `'${beyondRecord}' is not on the child's own agent record` };
  return null;
}
