/**
 * The findings clause of PROJECTOS-WORKER-RECORDS-SCRATCH-COMMIT1A (plan v1.44), as the OWNER APPROVED it, word for word.
 *
 * Kept here, once, as literal text and not imported from the source, so a test fails when the source's wording drifts from what was
 * approved. The sentences are separate so that each rule of the delta spec (2 to 5) is pinned by its own sentence.
 */
export const FINDING_DEFINITION =
  'A finding is a defect in your OWN work: write down every real defect you find, at its true severity, and mark it resolved only when you have fixed it in this run.';

export const LOOP_STEPS_ARE_NOT_FINDINGS =
  "The independent code review, the required checks and validators, and the closing of the phase are ProjectOS's own steps and happen after you finish; that they have not happened yet, or that you did not run them, is not a finding.";

export const CHECKOUT_HISTORY_IS_NOT_A_FINDING =
  "The checkout you work in may have no Git history, or a Git baseline that is not the brief's `repository.head`; ProjectOS prepared it that way, so that is not a finding either, and you need not verify the baseline against it.";

export const REVIEWS_ARE_YOUR_OWN =
  'In `reviews` name only reviews you yourself performed, never the independent review.';

export const WRITE_FROM_WHAT_IS_TRUE =
  'Write the findings record from what is true now, not by keeping an entry that is not a defect in your own work.';

export const EMPTY_WHEN_NO_DEFECT = 'If you found no defect, write an empty `findings` list.';

/** The whole clause: the six sentences in the approved order, one space between them. */
export const FINDINGS_CLAUSE_TEXT = [
  FINDING_DEFINITION,
  LOOP_STEPS_ARE_NOT_FINDINGS,
  CHECKOUT_HISTORY_IS_NOT_A_FINDING,
  REVIEWS_ARE_YOUR_OWN,
  WRITE_FROM_WHAT_IS_TRUE,
  EMPTY_WHEN_NO_DEFECT,
].join(' ');
