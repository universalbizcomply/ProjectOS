// Origin: original ProjectOS code
/**
 * Local model detection: ask a loopback endpoint which models it serves.
 *
 * THE LOOPBACK RULE RUNS BEFORE THE PORT. An address that is not `127.0.0.0/8`, `::1` or `localhost` is refused and
 * the port is never called for it, so this cannot be turned into a request to another host. The request itself goes
 * through an injected `getJson`: nothing here opens a socket. What comes back is data: model names are kept only if
 * they are short strings, and no more than 100 are kept.
 */

import { localEndpointProblem, type ModelApi } from '@projectos/core';

export interface LocalEndpoint {
  readonly baseUrl: string;
  readonly api: ModelApi;
}

export type LocalDetection =
  | { readonly baseUrl: string; readonly status: 'found'; readonly models: readonly string[] }
  | { readonly baseUrl: string; readonly status: 'unreachable'; readonly reason: string }
  | { readonly baseUrl: string; readonly status: 'refused'; readonly reason: string };

export interface LocalDetectionParams {
  readonly endpoints: readonly LocalEndpoint[];
  /** The only way out. It is given a loopback address and nothing else. */
  readonly getJson: (url: string) => Promise<unknown>;
}

export const MAX_LOCAL_MODELS = 100;
const MAX_MODEL_ID = 200;

/** The model-list address. An OpenAI-compatible address often already ends in /v1, and is not asked twice for it. */
function listUrlOf(baseUrl: string, api: ModelApi): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (api === 'ollama') return `${base}/api/tags`;
  return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
}

function namesOf(answer: unknown, api: ModelApi): readonly string[] | null {
  const row = answer as { data?: unknown; models?: unknown } | null;
  const list = api === 'ollama' ? row?.models : row?.data;
  if (!Array.isArray(list)) return null;
  const key = api === 'ollama' ? 'name' : 'id';
  const names = list
    .map((item) => (item as Record<string, unknown> | null)?.[key])
    .filter((name): name is string => typeof name === 'string' && name !== '' && name.length <= MAX_MODEL_ID);
  return names.slice(0, MAX_LOCAL_MODELS);
}

async function detectOne(endpoint: LocalEndpoint, getJson: LocalDetectionParams['getJson']): Promise<LocalDetection> {
  const problem = localEndpointProblem(endpoint.baseUrl);
  if (problem !== null) return { baseUrl: endpoint.baseUrl, status: 'refused', reason: problem };
  try {
    const answer = await getJson(listUrlOf(endpoint.baseUrl, endpoint.api));
    const models = namesOf(answer, endpoint.api);
    return models === null ? { baseUrl: endpoint.baseUrl, status: 'unreachable', reason: 'the answer is not a model list' } : { baseUrl: endpoint.baseUrl, status: 'found', models };
  } catch {
    return { baseUrl: endpoint.baseUrl, status: 'unreachable', reason: 'the endpoint did not answer' };
  }
}

export function detectLocalModels(params: LocalDetectionParams): Promise<readonly LocalDetection[]> {
  return Promise.all(params.endpoints.map((endpoint) => detectOne(endpoint, params.getJson)));
}
