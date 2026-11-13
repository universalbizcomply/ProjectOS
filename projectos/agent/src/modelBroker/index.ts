// Origin: original ProjectOS code
/**
 * The agent's half of the model broker (PROJECTOS-PORT-PROVIDERS1A): committed config loading and local model
 * detection, both behind injected ports. Nothing calls it yet: a later phase wires it.
 */
export { loadCommittedBrokerConfig, type BrokerConfigLoad, type BrokerConfigParams, type CommittedRead } from './committedConfig.js';
export { MAX_LOCAL_MODELS, detectLocalModels, type LocalDetection, type LocalDetectionParams, type LocalEndpoint } from './localModels.js';
