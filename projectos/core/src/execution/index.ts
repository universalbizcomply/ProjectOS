/**
 * ProjectOS authoritative execution runtime (CORE1A).
 *
 * The single controller/state-machine/provider contract consumed later by CLI, daemon and Tauri
 * (none wired in this phase). Pure/deterministic; the only bundled provider is the synthetic one.
 */
export * from './types.js';
export * from './errors.js';
export * from './recovery.js';
export * from './evidence.js';
export * from './stateMachine.js';
export * from './provider.js';
export * from './persistence.js';
export * from './commands.js';
export * from './controller.js';
export { SyntheticExecutionProvider, type SyntheticProviderConfig } from './providers/syntheticProvider.js';
