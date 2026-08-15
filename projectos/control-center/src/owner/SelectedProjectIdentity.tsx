/**
 * WHICH PROJECT THIS PAGE IS ABOUT — read-only.
 *
 * Owner Control holds the ONE interactive project selector. Every other surface that describes a
 * project states which one it is describing and offers no way to change it. Two pages used to carry
 * their own `<select>` over static fixture models, which meant three controls with the same label
 * backing onto three different sets of projects — one of them the real installed set, two of them a
 * list of projects this installation may not govern at all.
 *
 * A page cannot override, shadow or locally remember a project through this component: it holds no
 * state, takes no props, and reads the same authoritative inventory Owner Control acts on.
 *
 * THREE STATES, NEVER TWO. "Not reported yet", "nothing chosen" and "nothing available to choose"
 * are different situations and only one of them is the owner's to act on. Collapsing them tells an
 * owner their machine has no projects while the worker is still starting, or sends them to a page to
 * choose from an empty list.
 *
 * Created in PROJECTOS-PHASE6-SECTION-C.
 */
import { useGovernedProjects } from '../daemon/DaemonProvider';

export function SelectedProjectIdentity() {
  const inventory = useGovernedProjects();

  if (inventory === null) {
    return (
      <p className="ops-identity" role="status" data-testid="selected-project-identity-pending">
        Checking which project is selected.
      </p>
    );
  }

  const selected = inventory.projects.find((p) => p.projectId === inventory.selectedProjectId);
  if (selected === undefined) {
    return (
      <p className="ops-identity" role="status" data-testid="selected-project-identity-none">
        {inventory.projects.length === 0
          ? 'No project is available to work on, so there is nothing for this page to be about.'
          : 'No project chosen yet. Choose one on the Owner Control page to see this page for it.'}
      </p>
    );
  }
  return (
    <p className="ops-identity" role="status" data-testid="selected-project-identity">
      This page is about <strong>{selected.projectName}</strong> · repository{' '}
      <span data-testid="selected-project-identity-repo">{selected.repository}</span>. Change project
      on the Owner Control page.
    </p>
  );
}
