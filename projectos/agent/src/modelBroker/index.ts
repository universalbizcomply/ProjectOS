// Origin: original ProjectOS code
/**
 * The agent's half of the model broker (PROJECTOS-PORT-PROVIDERS1A): committed config loading and local model
 * detection, both behind injected ports. Nothing calls it yet: a later phase wires it. The one reader that is
 * called is the role registry's (PROJECTOS-PROVIDER-ROLES1A), by the read-only `projectos roles` report.
 */
export { loadCommittedBrokerConfig, type BrokerConfigLoad, type BrokerConfigParams, type CommittedRead } from './committedConfig.js';
export { loadCommittedRoleRegistry, type RoleRegistryLoad, type RoleRegistryParams } from './committedConfig.js';
export { MAX_LOCAL_MODELS, detectLocalModels, type LocalDetection, type LocalDetectionParams, type LocalEndpoint } from './localModels.js';
