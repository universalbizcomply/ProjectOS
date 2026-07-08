/** ProjectOS Local Agent — public API (for tests and programmatic use). */
export * from './system.js';
export * from './context.js';
export * from './flags.js';
export * from './templates.js';
export * from './phaseStore.js';
export * from './cli.js';
export { status } from './commands/status.js';
export { init } from './commands/init.js';
export { install } from './commands/install.js';
export { validate } from './commands/validate.js';
export { prompt } from './commands/prompt.js';
export { report } from './commands/report.js';
export { close } from './commands/close.js';
export { phase } from './commands/phase.js';
