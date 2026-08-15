/**
 * THE project selector — the first thing the owner sees, and the only way a project is chosen.
 *
 * WHAT IT SHOWS. The projects this installed ProjectOS may govern, taken verbatim from the runtime's
 * inventory, plus the name and repository identity of the one currently selected — so the owner can
 * see WHICH project the plan, objectives and governed actions below belong to before they use any of
 * them.
 *
 * WHAT IT SUBMITS. A project ID. Nothing else. There is no text field, no folder picker, no path
 * input and no "browse", because there is nothing here for a path to be typed into: the `<option>`
 * values are the ids the runtime supplied, and `project.select` accepts an id and refuses everything
 * else. A project the installed host did not supply is not in this list and cannot be reached from
 * it.
 *
 * WHAT IT DELIBERATELY IS NOT: a workspace manager, a folder browser, a repository scanner, a plugin
 * surface, or a second place to configure anything. It picks one of a known set.
 *
 * EVERY STATE IS ANNOUNCED. Selecting a project changes everything below this component, so the
 * change cannot be a silent visual one: the pending, switching, selected and refused states are all
 * live regions. A sighted owner sees the summary line change; an owner using a screen reader is told.
 *
 * Created in PROJECTOS-PHASE6-SECTION-C.
 */
import { useState } from 'react';
import { useGovernedProjects } from '../daemon/DaemonProvider';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';
import type { GovernedProjectsInventory } from '../governed/types';

/**
 * Plain-language explanation of a registry status token.
 *
 * The tokens are the installed host's own closed vocabulary. They are translated here rather than
 * shown raw because "invalid" is not a sentence, and because the owner's next step differs: nothing
 * set up yet is a different situation from something broken. No message names a path — telling a
 * reader where the file is tells them where to put one — and none uses the product's internal words
 * for its own machinery.
 */
function registryExplanation(status: string | null, projectCount: number): string | null {
  if (status === null) return null;
  if (status === 'ok') {
    return projectCount === 0
      ? 'No projects are set up on this computer yet, so there is nothing to work on here.'
      : null;
  }
  if (status === 'missing') {
    return 'No projects are set up on this computer yet. Setting one up needs an administrator, because ProjectOS keeps that list somewhere you cannot change by accident.';
  }
  return 'ProjectOS could not read the list of projects on this computer, so nothing can be worked on until that is put right. This needs an administrator.';
}

function SelectedSummary({ inventory }: { inventory: GovernedProjectsInventory }) {
  const selected = inventory.projects.find((p) => p.projectId === inventory.selectedProjectId);
  if (selected === undefined) {
    return (
      <p className="ops-selected" role="status" data-testid="project-selected-none">
        {inventory.projects.length === 0
          ? 'No project is available to work on.'
          : 'No project chosen yet. Choose one to see its plan, and to make objectives and governed actions available.'}
      </p>
    );
  }
  return (
    <p className="ops-selected" role="status" data-testid="project-selected">
      Working on <strong>{selected.projectName}</strong> · repository{' '}
      <span data-testid="project-selected-repo">{selected.repository}</span>
    </p>
  );
}

export function ProjectSelector() {
  const inventory = useGovernedProjects();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<readonly string[]>([]);

  // NOT KNOWN YET is not NONE. Rendering "no projects" before the runtime has reported would tell
  // the owner something untrue about their machine.
  if (inventory === null) {
    return (
      <section className="ops-selector" aria-labelledby="ops-selector-title">
        <h2 id="ops-selector-title">Project</h2>
        <p role="status" data-testid="project-inventory-pending">
          Checking which projects are set up on this computer.
        </p>
      </section>
    );
  }

  const explanation = registryExplanation(inventory.registryStatus, inventory.projects.length);
  // Shown whenever there is a choice to make: more than one project, OR one that has not been
  // chosen yet. Without the second case an owner could be told to choose with nothing to choose from.
  const showChooser = inventory.projects.length > 1 || inventory.selectedProjectId === null;

  async function select(projectId: string) {
    setBusy(true);
    setRefusal([]);
    try {
      // The ID travels as a typed argument on the closed governed vocabulary. The runtime's own
      // verdict is reported verbatim — a refusal is shown as the runtime worded it.
      const outcome = await requestGovernedCommand(tauriBridge, 'project.select', { projectId });
      if (!outcome.ok) setRefusal(outcome.lines);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ops-selector" aria-labelledby="ops-selector-title">
      <h2 id="ops-selector-title">Project</h2>

      <SelectedSummary inventory={inventory} />

      {showChooser && inventory.projects.length > 0 && (
        <label className="ops-select">
          {/* No `aria-label` on the control: this visible text IS its accessible name, so what a
              voice-control user says matches what a sighted user reads. */}
          <span className="ops-select-label">
            {inventory.selectedProjectId === null ? 'Choose project' : 'Switch project'}
          </span>
          <select
            data-testid="project-select"
            // `aria-disabled`, not `disabled`. Natively disabling the control the owner just used
            // throws keyboard focus to the document body with nothing to return it, so the handler
            // guards instead and the control stays where the owner left it.
            aria-disabled={busy}
            aria-busy={busy}
            value={inventory.selectedProjectId ?? ''}
            onChange={(e) => {
              if (busy || e.target.value === '') return;
              void select(e.target.value);
            }}
          >
            {/* Only offered while nothing is chosen. Left in place afterwards, picking it would
                leave the dropdown showing "Choose a project…" while the line above still named a
                project — a visible contradiction, because a no-op handler triggers no re-render. */}
            {inventory.selectedProjectId === null && <option value="">Choose a project…</option>}
            {inventory.projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.projectName} — {p.repository}
              </option>
            ))}
          </select>
        </label>
      )}

      {busy && (
        <p className="ops-registry" role="status" data-testid="project-select-pending">
          Switching project…
        </p>
      )}

      {explanation !== null && (
        <p className="ops-registry" role="status" data-testid="project-registry-status">
          {explanation}
        </p>
      )}

      {inventory.refusedCount > 0 && (
        <p className="ops-registry" role="status" data-testid="project-refused-count">
          {inventory.refusedCount}{' '}
          {inventory.refusedCount === 1 ? 'project is' : 'projects are'} not available, because what
          is on disk no longer matches what was set up. Nothing was changed — an administrator needs
          to look at this.
        </p>
      )}

      {refusal.length > 0 && (
        <div className="ops-refusal" role="alert" data-testid="project-select-refusal">
          {refusal.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      )}
    </section>
  );
}
