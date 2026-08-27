/**
 * The project constellation — README §Screens 11. Command mode only.
 *
 * A labelled `role="dialog"`, closable with Esc or its own button. Every node is a project the
 * installed host validated; clicking one selects it through the same governed command the rail uses.
 * Only the selected project has a measured state, so every other node carries the idle colour and
 * says "Not read yet" rather than borrowing a status it has not earned.
 *
 * The scrim is opaque rather than blurred: `backdrop-filter` blanks the canvas in every capture path
 * and is not used anywhere in this implementation.
 */
import { useEffect, useRef } from 'react';
import { useGovernedProjects } from '../daemon/DaemonProvider';
import { dotColour, type ProjectState } from './workspaceModel';
import { IconClose } from './icons';

export function Constellation({
  selectedState,
  selectedLabel,
  onClose,
  onPick,
}: {
  selectedState: ProjectState;
  selectedLabel: string;
  onClose: () => void;
  onPick: (projectId: string) => void;
}) {
  const inventory = useGovernedProjects();
  const projects = inventory?.projects ?? [];
  const selectedId = inventory?.selectedProjectId ?? null;
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    card.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="os-map" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="os-mapcard os-glass os-hud os-enter-a"
        role="dialog"
        aria-modal="true"
        aria-label="All projects"
        tabIndex={-1}
        ref={card}
      >
        <div className="os-maphead">
          <div>
            <h2 className="os-h2">Everything you have running</h2>
            <p>Pick one to open it. Colour shows its state.</p>
          </div>
          <button type="button" className="os-ghost" onClick={onClose} aria-label="Close" style={{ padding: 6 }}>
            <IconClose size={17} width={1.7} />
          </button>
        </div>
        <svg viewBox="0 0 660 380" width="100%" height={360} role="list">
          <circle className="os-core-pulse" cx={330} cy={190} r={34} fill="var(--acc)" fillOpacity={0.14} />
          <circle className="os-core-ring" cx={330} cy={190} r={26} fill="none" stroke="var(--acc)" strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 8" />
          <circle cx={330} cy={190} r={7} fill="var(--acc)" />
          <text x={330} y={216} textAnchor="middle" fontSize={11} fill="var(--faint)">ProjectOS</text>
          {projects.map((p, i) => {
            const a = (Math.PI * 2 * i) / Math.max(1, projects.length) - Math.PI / 2;
            const x = Math.round(330 + Math.cos(a) * 236);
            const y = Math.round(190 + Math.sin(a) * 122);
            const below = Math.sin(a) >= 0;
            const active = p.projectId === selectedId;
            const state: ProjectState = active ? selectedState : 'ready';
            const label = active ? selectedLabel : 'Not read yet';
            return (
              <g className="os-node" role="listitem" key={p.projectId} onClick={() => onPick(p.projectId)}>
                <title>{`${p.projectName} — ${label}`}</title>
                <line x1={330} y1={190} x2={x} y2={y} stroke={dotColour(state)} strokeOpacity={0.3} strokeWidth={1} />
                <circle cx={x} cy={y} r={active ? 20 : 14} fill={dotColour(state)} fillOpacity={0.14} />
                <circle cx={x} cy={y} r={8} fill={dotColour(state)} stroke={active ? 'var(--ink)' : 'transparent'} strokeWidth={active ? 2 : 0} />
                <text x={x} y={y + (below ? 32 : -24)} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--ink)">
                  {p.projectName}
                </text>
                <text x={x} y={y + (below ? 48 : -8)} textAnchor="middle" fontSize={11.5} fill="var(--dim)">
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
