// Origin: original ProjectOS code
/** One place in a fallback chain: a provider name and one of its models. */
export interface RouteEntry {
  readonly provider: string;
  readonly model: string;
}

/** `provider/model`, the key a price, a rate card and a tried-set all use. */
export const routeKeyOf = (entry: RouteEntry): string => `${entry.provider}/${entry.model}`;
