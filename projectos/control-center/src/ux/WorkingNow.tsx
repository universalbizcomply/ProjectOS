/**
 * WHAT PROJECTOS IS DOING, WHILE IT IS DOING IT.
 *
 * 2026-09-04: the owner approved a plan, ProjectOS started the worker, and the screen he was looking
 * at said "Working — Continue where you left off — last worked on 10 hours ago" over a run that had
 * begun three minutes earlier. Nothing on the project screen reflected the live run at all, and the
 * one button offered would have tried to start a second one. "There are no visual of items being
 * worked" was the whole of the report, and it was right.
 *
 * THE SOURCE IS THE PROCESS, NOT A FILE. `GovernedRunState` is maintained from the run the sidecar
 * SPAWNED AND TRACKS — `run-started`, `run-output`, `run-finished` — never inferred from watching
 * records. That is what makes this card able to say "is working" in the present tense. A checkpoint
 * on disk can only ever say what was last written down, which is exactly how a dead run came to be
 * displayed as a live one.
 *
 * IT SHOWS, IT DOES NOT INTERPRET. The lines are the runtime's own output, in its own words, most
 * recent last. Nothing here summarises them, and nothing here concludes anything from them — a card
 * that guessed "nearly done" from stdout would be inventing progress the runtime never claimed.
 *
 * Created in the owner-journey work, after PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { useEffect, useRef, useState } from 'react';
import type { GovernedRunState } from '../daemon/types';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';

/** How many of the runtime's own lines the owner sees without opening anything. */
const VISIBLE_LINES = 6;

/**
 * Control characters and bidirectional overrides never reach the owner's screen.
 *
 * These lines are the loop's stdout, which carries a worker's output and a provider's words. The
 * same rule the proposal text follows: strip what can reorder or hide the rest, and bound it.
 */
function clean(line: string): string {
  const kept: string[] = [];
  for (const ch of line) {
    const c = ch.codePointAt(0) ?? 0;
    // C0, DEL and C1. C1 (0x80-0x9f) are control characters too, and the claim above is that none
    // of them reach the screen.
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) continue;
    if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0x200e || c === 0x200f || c === 0x061c) continue;
    kept.push(ch);
  }
  // TRUNCATED BY CHARACTER, NOT BY CODE UNIT. `slice` counts UTF-16 units, so a cap landing inside
  // an astral character (an emoji in a worker's output is ordinary) would leave half of one behind.
  return kept.length > 300 ? `${kept.slice(0, 300).join('')}…` : kept.join('');
}

/** "4 minutes", "just now" — how long it has been going, in words. */
export function elapsedPhrase(startedAt: string | null, now: number): string {
  if (startedAt === null) return 'just now';
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return 'just now';
  const secs = Math.max(0, Math.round((now - started) / 1000));
  if (secs < 60) return 'less than a minute';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export function WorkingNow({
  run,
  stepPurpose,
  stepNumber,
  stepCount,
  now,
}: {
  readonly run: GovernedRunState;
  /** The plain sentence the plan gives this step. Null when the runtime has not named one. */
  readonly stepPurpose: string | null;
  readonly stepNumber: number | null;
  readonly stepCount: number | null;
  readonly now: number;
}) {
  const [stopping, setStopping] = useState(false);
  const [said, setSaid] = useState<readonly string[]>([]);
  const feed = useRef<HTMLDivElement | null>(null);
  const inFlight = useRef(false);

  // The newest line is the interesting one, so the feed follows it.
  // ON THE ARRAY, NOT ITS LENGTH. The store's buffer is bounded, so once it is full the length stops
  // changing while the content still does - and the feed would silently stop following the newest
  // line for the rest of a long run. The array is replaced immutably on every push.
  useEffect(() => {
    if (feed.current !== null) feed.current.scrollTop = feed.current.scrollHeight;
  }, [run.lines]);

  const lines = run.lines.slice(-VISIBLE_LINES).map((l) => clean(l.line)).filter((l) => l.trim() !== '');
  const step = stepNumber !== null && stepCount !== null ? `Step ${stepNumber} of ${stepCount}` : null;

  async function stop(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setStopping(true);
    try {
      const r = await requestGovernedCommand(tauriBridge, 'run.stop', {});
      setSaid(r.lines);
    } finally {
      setStopping(false);
      inFlight.current = false;
    }
  }

  // ONE LIVE REGION, NOT TWO. The feed below is a `role="log"`, which is already announced; making
  // the whole card live as well would nest live regions and re-announce the elapsed time every time
  // it ticks. The heading and the standing text say what is happening; the log says what is new.
  return (
    <section className="os-plate ux-working" aria-labelledby="ux-working-title">
      <p className="ux-statusline">
        <span className="ux-workingdot" aria-hidden="true" />
        <span>ProjectOS is working</span>
      </p>
      <h2 className="os-h2" id="ux-working-title">
        {/* A phase id is an internal identifier; if the plan has no sentence for this step, say
            something true in plain words rather than surfacing the id as a heading. */}
        {stepPurpose ?? 'Working through the approved plan'}
      </h2>
      <p className="os-set-sub">
        {step === null ? '' : `${step} · `}
        Running for {elapsedPhrase(run.startedAt, now)}
        {run.resumed ? ' · resumed' : ''}
      </p>

      <div className="ux-needs-nothing">
        <strong>You do not need to do anything.</strong> ProjectOS does the ordinary technical work
        itself and will stop and ask you if your authority is needed.
      </div>

      {lines.length > 0 && (
        <div className="ux-feedbox" ref={feed} role="log" aria-label="What ProjectOS is doing">
          {lines.map((l, i) => (
            <p className="ux-feedline" key={`${i}-${l.slice(0, 24)}`}>
              {l}
            </p>
          ))}
        </div>
      )}

      <div className="ux-planactions">
        <button type="button" className="os-sec" onClick={() => void stop()} disabled={stopping}>
          {stopping ? 'Stopping…' : 'Stop'}
        </button>
      </div>
      {said.length > 0 && (
        <div className="os-lines" role="status">
          {said.map((l, i) => (
            <p key={`${i}-${l.slice(0, 24)}`}>{l}</p>
          ))}
        </div>
      )}
    </section>
  );
}
