/**
 * First run — README §Screens 10. Replaces the canvas in both modes when nothing is registered.
 */
import { IconPlus } from './icons';

const POINTS: ReadonlyArray<{ n: string; title: string; note: string }> = [
  { n: '1', title: 'Add a project', note: 'Pick the folder your work lives in. Windows asks permission once.' },
  { n: '2', title: 'Say what you want', note: 'In your own words. You see the plan before anything happens.' },
  { n: '3', title: 'Carry on any time', note: 'It picks up where it stopped, and asks whenever a decision is yours.' },
];

export function FirstRun({ onAddProject }: { onAddProject: () => void }) {
  return (
    <div className="os-firstrun">
      <div>
        <h1>Let&rsquo;s add your first project</h1>
        <p className="os-firstrun-lede">
          ProjectOS works on folders of work you already have, or on something brand new. Point it at
          one and it takes it from there.
        </p>
      </div>
      <div>
        <button type="button" className="os-pri" onClick={onAddProject}>
          <IconPlus size={18} width={1.8} />
          Add a project
        </button>
      </div>
      <section className="os-plate-sm os-glass os-hud">
        <div className="os-hudlabel"><span>how it works</span><span className="rule" /><span>three things</span></div>
        <div className="os-threepoints">
          {POINTS.map((p) => (
            <div key={p.n}>
              <div className="os-point-n">{p.n}</div>
              <div className="os-point-t">{p.title}</div>
              <div className="os-point-n2">{p.note}</div>
            </div>
          ))}
        </div>
      </section>
      <p className="os-closing">
        Nothing runs, sends, publishes or pays without you saying yes — that stays true whichever
        appearance you pick.
      </p>
    </div>
  );
}
