/**
 * WHAT THIS BUILD CAN ACTUALLY REACH, SAID ONCE AND SAID PLAINLY.
 *
 * ProjectOS governs work on a computer. The projection, every one of the sixteen governed verbs,
 * the credential write and the worker all travel the native bridge to a local host; a plain browser
 * has none of them. `createDesktopTransport` already does the right thing — a browser build gets
 * `NullTransport` and the shell reports a runtime that is not answering — and Health, the Control
 * Center and Connections all say so truthfully.
 *
 * WHAT THEY DO NOT SAY is WHY. "The runtime is not answering" is the correct sentence on a desktop
 * where a host exists and has stopped: waiting or restarting it fixes the problem. In a hosted
 * browser it is misleading in the one way that matters — it describes a temporary outage, when in
 * fact nothing about this page will ever reach a computer. An owner who waits is waiting for
 * something that cannot arrive.
 *
 * This is the distinction, drawn once at the shell so no screen has to repeat it: a host is either
 * PRESENT (the installed desktop application, where everything below is reachable) or ABSENT (this
 * page, where it is not, and never will be). It claims nothing about whether a present host is
 * healthy — that is Health's job, and it is not duplicated here.
 *
 * Created in PROJECTOS-CONTROL-CENTER-INTEGRATION1A.
 */
import { tauriBridge } from '../daemon/tauriBridge';

/**
 * Whether this build can reach a local ProjectOS at all.
 *
 * The same question `Connections` already asks before offering to store a credential, named once so
 * every surface answers it identically rather than each re-deriving it.
 */
export function hasLocalHost(): boolean {
  return tauriBridge.isTauri();
}

/**
 * The one banner. Rendered by the shell above the canvas, only when there is no host.
 *
 * It is a `note`, not an `alert`: nothing has gone wrong, and a page that shouts at an owner who
 * opened a link is worse than one that explains itself. It names what IS available here so the
 * sentence is not purely a refusal.
 */
export function NoLocalHostNotice() {
  if (hasLocalHost()) return null;
  return (
    <div className="ux-hostnotice" role="note">
      <strong>You are looking at ProjectOS in a web browser.</strong>
      <p>
        ProjectOS runs your projects on your own computer, so this page cannot reach them. It cannot
        list your projects, open a plan, start or stop work, or store a key — not because something
        is broken, but because none of that lives here. Everything you see is what this page can
        honestly show on its own.
      </p>
      <p>
        To work on a project, open the ProjectOS application on the computer that holds it.
      </p>
    </div>
  );
}
