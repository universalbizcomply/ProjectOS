// ProjectOS Watchdog Core — public entry point.
// Dependency-free; runs unchanged in Deno (product Edge Functions) and Node.

export * from "./version.ts";
export * from "./status.ts";
export * from "./metadata.ts";
export * from "./identity.ts";
export * from "./incidents.ts";
export * from "./notifications.ts";
export * from "./jobs.ts";
export * from "./runner.ts";
export * from "./release.ts";
export * from "./sentinel.ts";
export * from "./email.ts";
export * from "./compare.ts";
