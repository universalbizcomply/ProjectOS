/**
 * ChatGPT hand-off — no API, no key. ProjectOS builds the advisor prompt for a phase and
 * opens ChatGPT in the browser (the owner's logged-in session) with the prompt prefilled,
 * and also copies it to the clipboard as a fallback. The owner pastes ChatGPT's reply back
 * into the phase's advisor note. This is the `advisor` worker, human-mediated via the browser.
 */
import type { PhaseStatus } from '@projectos/core';

export interface AdvisorContext {
  readonly project: string;
  readonly phaseId: string;
  readonly objective: string;
  readonly status: PhaseStatus;
}

/** Architect prompt for early phases; review prompt once work is done. */
export function buildAdvisorPrompt(ctx: AdvisorContext): string {
  const reviewing = ctx.status === 'awaiting_review' || ctx.status === 'awaiting_closure' || ctx.status === 'evidence';
  if (reviewing) {
    return `You are ChatGPT acting as the ADVISOR/REVIEWER in ProjectOS for Murad.

Project: ${ctx.project}
Phase: ${ctx.phaseId} (status: ${ctx.status})
Objective: ${ctx.objective}

The implementer (Claude) has finished. Review this phase:
- Is the objective met? Any gaps or risks?
- What must be verified before closure?
- Recommend: CLOSE or CHANGES-NEEDED (with specifics).
Only Murad closes — you recommend. Keep it concise and actionable.`;
  }
  return `You are ChatGPT acting as the ADVISOR/ARCHITECT in ProjectOS for Murad.

Project: ${ctx.project}
Phase: ${ctx.phaseId} (status: ${ctx.status})
Objective: ${ctx.objective}

Architect this phase for the implementer (Claude):
- Scope: what's in / out
- Concrete steps
- Risks + how to de-risk
- Required validators / evidence
- Anything owner-gated (deploy, prod DB, secrets) to flag
Keep it tight and directly usable as an implementation brief.`;
}

/** Copy the prompt to the clipboard and open ChatGPT with it prefilled. */
export async function openChatGPT(prompt: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    /* clipboard may be blocked; the URL still carries the prompt */
  }
  const url = 'https://chatgpt.com/?q=' + encodeURIComponent(prompt);
  window.open(url, '_blank', 'noopener');
}
