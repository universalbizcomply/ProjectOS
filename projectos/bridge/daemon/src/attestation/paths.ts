/**
 * Owner-trust root path modelling (pure strings; no filesystem access). Path placement alone never
 * makes a store trusted — see StoreProtection. Created in PROJECTOS-OWNER-ATTESTATION-STORE1A.
 */

export const OWNER_TRUST_STORE_VERSION = 'v1' as const;

/** Model the future production root: `<localAppData>\ProjectOS\owner-trust\v1`. */
export function productionOwnerTrustRoot(localAppData: string): string {
  const base = localAppData.replace(/[\\/]+$/, '');
  return `${base}\\ProjectOS\\owner-trust\\${OWNER_TRUST_STORE_VERSION}`;
}

/** True iff `candidate` (already canonicalised) is inside `root`. Rejects traversal/escape. */
export function isWithinRoot(root: string, candidate: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = norm(root);
  const c = norm(candidate);
  return c === r || c.startsWith(`${r}/`);
}
