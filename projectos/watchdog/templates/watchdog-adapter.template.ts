// <PRODUCT> Watchdog adapter — generated from the ProjectOS template.
//
// This file belongs to the PRODUCT, not to the vendored core. It lives outside
// the core install path, so watchdog-sync never touches it. It declares WHAT to
// check; the core decides incidents, severity, deduplication, recovery,
// notifications and run truth. Put product business rules here (or in the
// product's own read-only SQL functions), never in the core.
//
// Rules for check packs:
//   * declare every check_id and the exact metadata keys/types it may emit
//   * return one result per check (per scope for scoped checks)
//   * status is PASS / INFO / WARN / CRITICAL / ERROR; use ERROR when the check
//     could not establish health — never PASS by default
//   * metadata: numbers, booleans, short machine codes only. No customer data,
//     free text, provider payloads, stack traces or credentials
//   * scope checks that can fail independently (per site, per device,
//     per component) so one scope never hides another

import type { CheckPack, JobSpec } from "./watchdog-core/src/index.ts";
import { JOB_HEALTH_CHECK_ID, JOB_HEALTH_METADATA, evaluateJob } from "./watchdog-core/src/index.ts";

export const PROJECT_SOURCE_RUNNER = "runner";
export const PROJECT_SOURCE_WATCHDOG = "watchdog";

// Critical scheduled/background jobs. Must match .projectops/watchdog.json
// critical_jobs (the conformance validator compares them in later phases).
export const CRITICAL_JOBS: JobSpec[] = [
  // { job_id: "example-job", expected_interval_s: 300, stale_after_s: 900, max_run_s: 120, failure_threshold: 3, scheduler_required: true },
];

// Example business check pack. Replace with the product's real checks.
export function businessPack(rpc: (fn: string) => Promise<unknown>): CheckPack {
  return {
    name: "business",
    checks: [
      // { check_id: "example_backlog", metadata: { pending_count: { type: "integer" }, oldest_age_s: { type: "integer" } } },
    ],
    async run() {
      // const rows = await rpc("<product read-only check function>");
      // return rows as unknown[];
      void rpc;
      return [];
    },
  };
}

// Job health for the product's critical jobs, from watchdog_job_states().
export function jobsPack(loadStates: () => Promise<{ db_now: string; jobs: unknown[] }>): CheckPack {
  return {
    name: "jobs",
    checks: [{ check_id: JOB_HEALTH_CHECK_ID, metadata: JOB_HEALTH_METADATA }],
    async run() {
      const { db_now, jobs } = await loadStates();
      const byId = new Map((jobs as Array<{ job_id: string }>).map((j) => [j.job_id, j]));
      return CRITICAL_JOBS.map((spec) => evaluateJob(spec, (byId.get(spec.job_id) as never) ?? null, db_now));
    },
  };
}
