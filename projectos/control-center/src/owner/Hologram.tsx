/**
 * The operator hologram and the state reticle — README §Screens 2, §Screens 3, §Assets.
 *
 * THE ARTWORK IS THE OWNER'S OWN, SUPPLIED WITH THE HANDOFF. Three alpha-keyed layers, so the eyes
 * blink and the mouth articulates independently of the head. The band geometry is the handoff's:
 * eye slit 44.55–48.75% of height, mouth 60.5–71%. If the portrait is ever replaced, those bands
 * have to be re-cut — they are in `styles.css`, next to the animations that use them.
 *
 * Every layer here is decorative and marked `aria-hidden`; the head carries the only alt text, and
 * the reticle prints its state as a WORD underneath, so nothing about the projection is colour- or
 * image-only.
 */
import { coreLabel, dotColour, type ProjectState } from './workspaceModel';

const HEAD = '/operator/operator-head.png';
const EYES = '/operator/operator-eyes.png';
const MOUTH = '/operator/operator-mouth.png';

/** The three layers, on their own. Used inside both the hero aside and the dashboard centre. */
export function OperatorLayers({ speaking }: { speaking: boolean }) {
  return (
    <div className="os-holowrap" data-speaking={speaking ? '1' : '0'}>
      <img className="flicker" src={HEAD} alt="Holographic projection of the owner" />
      <img className="os-eyes" src={EYES} alt="" aria-hidden="true" />
      <img className="os-mouth" src={MOUTH} alt="" aria-hidden="true" />
    </div>
  );
}

/** The hero's `operator // link` aside. Command mode only — CSS hides it in Standard. */
export function OperatorAside({
  speaking,
  label,
  readout,
}: {
  speaking: boolean;
  label: string;
  readout: string;
}) {
  return (
    <aside className="os-operator">
      <div className="os-hudlabel" style={{ marginBottom: 10 }}>
        <span>operator // link</span>
        <span className="rule" />
        <span>{label}</span>
      </div>
      <div className="os-holo">
        <div className="os-holo-inner">
          <OperatorLayers speaking={speaking} />
        </div>
        <span className="scanlines" aria-hidden="true" />
        <span className="beam" aria-hidden="true" />
        <span className="rings" aria-hidden="true" />
        <span className="base" aria-hidden="true" />
      </div>
      <div className="os-operator-meta">
        <span>LINK STABLE</span>
        <span>{readout}</span>
      </div>
    </aside>
  );
}

/** The dashboard's full-height projection, on its plinth. */
export function OperatorProjection({ speaking }: { speaking: boolean }) {
  return (
    <div className="os-dashholo">
      <OperatorLayers speaking={speaking} />
      <span className="scanlines" aria-hidden="true" />
      <span className="glow" aria-hidden="true" />
      <span className="ring1" aria-hidden="true" />
      <span className="ring2" aria-hidden="true" />
      {speaking && <span className="os-speaking os-mono">SPEAKING</span>}
    </div>
  );
}

/**
 * The state reticle. Thirty-six ticks around the rim, lit up to the project's real progress; the
 * ring, the counter-rotating arcs, the pulse and one orbiting node. The percentage in the middle
 * and the word underneath are both derived — see `workspaceModel`.
 */
export function CoreReticle({
  state,
  percentLabel,
  fraction,
}: {
  state: ProjectState;
  percentLabel: string;
  fraction: number;
}) {
  const colour = dotColour(state);
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 36;
    const lit = i / 36 <= fraction;
    const r1 = 54;
    const r2 = lit ? 62 : 59;
    return {
      x1: (75 + Math.cos(a) * r1).toFixed(1),
      y1: (75 + Math.sin(a) * r1).toFixed(1),
      x2: (75 + Math.cos(a) * r2).toFixed(1),
      y2: (75 + Math.sin(a) * r2).toFixed(1),
      op: lit ? 0.85 : 0.22,
    };
  });
  return (
    <div className="os-core">
      <svg viewBox="0 0 150 150" width={150} height={150} aria-hidden="true" focusable="false">
        <g className="os-core-ring">
          {ticks.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={colour} strokeOpacity={t.op} strokeWidth={1} />
          ))}
        </g>
        <circle cx={75} cy={75} r={62} fill="none" stroke={colour} strokeOpacity={0.14} strokeWidth={1} />
        <circle cx={75} cy={75} r={46} fill="none" stroke={colour} strokeOpacity={0.12} strokeWidth={1} />
        <line x1={4} y1={75} x2={20} y2={75} stroke={colour} strokeOpacity={0.4} strokeWidth={1} />
        <line x1={130} y1={75} x2={146} y2={75} stroke={colour} strokeOpacity={0.4} strokeWidth={1} />
        <path className="os-core-arc" d="M75 29 a46 46 0 0 1 43 31" fill="none" stroke={colour} strokeWidth={2} strokeLinecap="round" />
        <path className="os-core-arc" d="M75 121 a46 46 0 0 1 -43 -31" fill="none" stroke={colour} strokeWidth={1.5} strokeOpacity={0.6} strokeLinecap="round" />
        <circle className="os-core-pulse" cx={75} cy={75} r={30} fill={colour} fillOpacity={0.16} />
        <circle cx={75} cy={75} r={30} fill="none" stroke={colour} strokeOpacity={0.28} strokeWidth={1} />
        <g className="os-core-orbit">
          <circle cx={75} cy={9} r={3} fill={colour} />
          <circle cx={75} cy={9} r={7} fill={colour} fillOpacity={0.22} />
        </g>
        <text x={75} y={80} textAnchor="middle" fontFamily="ui-monospace,SFMono-Regular,Menlo,monospace" fontSize={17} fill={colour}>
          {percentLabel}
        </text>
      </svg>
      {/* The state as a WORD, printed beneath the ring. Never colour alone. */}
      <span className="os-core-label">{coreLabel(state)}</span>
    </div>
  );
}
