/**
 * Report + evidence watcher — pure. Detects newly-appeared report/evidence files by diffing
 * directory listings and maps them to canonical events. When both a report and evidence are
 * present, a single REVIEW_READY is implied (the phase is ready for owner/advisor review).
 */

/** Entries present in `next` but not in `prev`. */
export function newEntries(prev: readonly string[], next: readonly string[]): readonly string[] {
  const before = new Set(prev);
  return next.filter((n) => !before.has(n));
}

export type ReportSignal = 'REPORT_CREATED' | 'EVIDENCE_CREATED' | 'REVIEW_READY';

export interface ReportSignals {
  readonly signals: readonly ReportSignal[];
}

/**
 * Given prior/current listings of the reports and evidence dirs, derive which report signals
 * fired. REVIEW_READY is emitted when both a report and evidence exist and at least one of
 * them is newly added this cycle.
 */
export function reportSignals(
  prevReports: readonly string[],
  nextReports: readonly string[],
  prevEvidence: readonly string[],
  nextEvidence: readonly string[],
): ReportSignals {
  const signals: ReportSignal[] = [];
  const newReports = newEntries(prevReports, nextReports);
  const newEvidence = newEntries(prevEvidence, nextEvidence);
  if (newReports.length > 0) signals.push('REPORT_CREATED');
  if (newEvidence.length > 0) signals.push('EVIDENCE_CREATED');

  const hasReport = nextReports.length > 0;
  const hasEvidence = nextEvidence.length > 0;
  const somethingNew = newReports.length > 0 || newEvidence.length > 0;
  if (hasReport && hasEvidence && somethingNew) signals.push('REVIEW_READY');
  return { signals };
}
