// Origin: original ProjectOS code
/**
 * WHAT THIS CHECKOUT IS GOVERNED AS (PROJECTOS-CONTEXT-MANAGER1A, review round 1, item 3).
 *
 * The retrieval key is the admitted envelope's tenant and project. An envelope is minted for the checkout the process stood in
 * when `projectos run` started, so the two agree in a normal run; this is the second look that makes it a property and not a
 * hope: the installation's own tenant registry is asked, from the project's own declared id and the checkout's origin and root,
 * what THIS checkout is. The context manager reads nothing unless the envelope's pair is that answer.
 *
 * It is read from the installation (the committed registries) and from the checkout, and it takes nothing from the envelope, a
 * request, a stored file or a worker. It does not ask for the owner receipt: `projectos run` already did, at admission.
 * `null` when anything cannot be read, which refuses the run.
 */
import { bindCheckout, declaredProjectId, readInstallationRegistries, tenantSourceOf } from '../governedContext.js';
import type { System } from '../system.js';
import type { ContextCheckoutIdentity } from './contextPorts.js';

export function checkoutIdentityOf(sys: System, root: string): ContextCheckoutIdentity | null {
  try {
    const projectId = declaredProjectId(sys, root);
    if (projectId === null) return null;
    const registries = readInstallationRegistries(sys, tenantSourceOf({}).installRoot);
    if (!registries.ok) return null;
    const bound = bindCheckout(sys, root, projectId, registries);
    return bound.ok ? { tenant: bound.binding.tenant, project: bound.binding.projectId } : null;
  } catch {
    return null;
  }
}
