/**
 * Work done — README §Screens 8.
 *
 * Everything ProjectOS has recorded, newest first, with the four approved filters. The source is
 * each phase's own transition history: what moved, when, and who recorded it. There is no separate
 * "evidence" store to read and nothing is summarised — a row exists because a transition exists.
 *
 * ACROSS PROJECTS MEANS ACROSS WHAT HAS BEEN READ. The projection describes the selected project;
 * no other project's records have been opened, so none appear. "Everything" is therefore everything
 * ProjectOS has actually read, which is the only list it can honestly offer.
 */
import { useState } from 'react';
import { useGovernedState } from '../daemon/DaemonProvider';
import { dotColour, recordedItems, shortWhen } from './workspaceModel';
import { IconBack } from './icons';

type Filter = 'all' | 'this' | 'decisions' | 'waiting';

export function WorkDone({ projectName, onBack }: { projectName: string; onBack: () => void }) {
  const governed = useGovernedState();
  const live = governed !== null && governed.connected ? governed : null;
  const [filter, setFilter] = useState<Filter>('all');
  const now = Date.now();

  const all = live === null ? [] : recordedItems(live);
  const rows = all.filter((r) => {
    if (filter === 'decisions') return r.byOwner;
    if (filter === 'waiting') return r.waiting;
    return true;
  });

  const filters: ReadonlyArray<{ id: Filter; label: string }> = [
    { id: 'all', label: 'Everything' },
    { id: 'this', label: projectName },
    { id: 'decisions', label: 'Your decisions' },
    { id: 'waiting', label: 'Still waiting' },
  ];

  return (
    <div className="os-stack">
      <div>
        <button type="button" className="os-ghost" onClick={onBack} style={{ marginBottom: 18, fontSize: '13.5px' }}>
          <IconBack />
          Back to {projectName}
        </button>
        <h1 className="os-h1">Work done</h1>
        <p className="os-lede">
          {all.length === 0
            ? 'Nothing has been finished yet.'
            : `${all.length} things recorded, newest first.`}
        </p>
      </div>

      <div className="os-filters" role="group" aria-label="Filter recorded work">
        {filters.map((f) => (
          <button
            type="button"
            key={f.id}
            className="os-filter"
            data-on={filter === f.id ? '1' : '0'}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <section className="os-donerows">
        {rows.map((r) => (
          <button type="button" className="os-donerow" key={r.id} onClick={onBack}>
            <span className="os-dot" style={{ background: dotColour(r.state) }} aria-hidden="true" />
            <span className="os-donebody">
              <span className="os-donetitle">{r.title}</span>
              <span className="os-donemeta">{projectName} · {r.outcome}</span>
            </span>
            <span className="os-donewhen">{shortWhen(r.at, now)}</span>
          </button>
        ))}
        {rows.length === 0 && (
          <div className="os-doneempty">
            Nothing here yet. Anything ProjectOS finishes, and every decision you make, gets written
            down here.
          </div>
        )}
      </section>

      <section className="os-doneclose os-glass os-hud">
        <div className="os-hudlabel"><span>evidence // kept for every item</span><span className="rule" /><span>read only</span></div>
        <p>
          Every line above keeps its own record: what changed, what was checked, what you approved and
          when. Open a project&rsquo;s Advanced panel to read the technical version.
        </p>
      </section>
    </div>
  );
}
