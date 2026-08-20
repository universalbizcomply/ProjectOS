/**
 * WHICH gatekeeper gets asked — and what happens when none can be.
 *
 * WHY AN ABSTRACTION AND NOT AN OPENAI CLIENT. The approved scope says the transport must be
 * "behind a transport abstraction so no single vendor route is hard-wired". This module is that
 * abstraction and deliberately contains no vendor code, no network call and no credential. It decides
 * eligibility and refusals; an adapter elsewhere does the talking. Keeping the decision pure is what
 * makes it testable without an API key, which matters because paid API activation is a separate owner
 * gate that has not been reached.
 *
 * THE THREE PROPERTIES THIS ENFORCES.
 *
 *   1. STRUCTURALLY READ-ONLY. A gatekeeper reviews and decides. A transport descriptor that claims
 *      any mutating capability — write, commit, push, deploy, database, external message, payment,
 *      credential access, shell — is refused outright. The reviewer "never touches the machine" is an
 *      architectural commitment already recorded in this repository; here it becomes a check.
 *
 *   2. NO SILENT FALLBACK. If the configured gatekeeper cannot be reached, ProjectOS does NOT quietly
 *      try a different one. Automatically sliding from a reviewed transport to an unreviewed one is
 *      indistinguishable, from the outside, from the review having happened. Unavailability surfaces
 *      to the owner as an explicit choice instead.
 *
 *   3. A LOCAL MODEL IS NEVER THE GATEKEEPER. It may rehearse the plumbing so the loop can be proven
 *      without spend. It can never be the accepted reviewer, because a review by something the
 *      implementer's own machine runs is not independent oversight.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */

/** Transport families this abstraction knows about. Closed, for the same reason verdicts are. */
export const GATEKEEPER_TRANSPORT_KINDS = ['openai-responses', 'codex-cli', 'local-rehearsal'] as const;
export type GatekeeperTransportKind = (typeof GATEKEEPER_TRANSPORT_KINDS)[number];

/**
 * Kinds that may never be the accepted gatekeeper however they are configured.
 *
 * `local-rehearsal` exists so the loop — request shaping, binding, refusal handling, restart — can be
 * proven end to end before a single paid call is made. That is genuinely useful and genuinely not a
 * review.
 */
export const REHEARSAL_ONLY_KINDS: readonly GatekeeperTransportKind[] = ['local-rehearsal'];

/**
 * Capabilities that disqualify a transport from being a gatekeeper.
 *
 * The list is what it is because each entry is an effect the plan reserves to the owner or forbids
 * entirely. A transport does not need any of them to read evidence and return a verdict.
 */
export const FORBIDDEN_GATEKEEPER_CAPABILITIES: readonly string[] = [
  'write-source',
  'file-write',
  'commit',
  'push',
  'deploy',
  'database-mutation',
  'external-message',
  'payment',
  'credential-access',
  'shell',
  'browser-automation',
];

/** The minimum a transport must be able to do to be useful at all. */
export const REQUIRED_GATEKEEPER_CAPABILITIES: readonly string[] = ['submit-request', 'receive-decision'];

/**
 * A configured route to a gatekeeper. Trusted CONFIGURATION, not a request — nothing a model returns
 * may construct one of these.
 */
export interface GatekeeperTransportDescriptor {
  readonly transportId: string;
  readonly kind: GatekeeperTransportKind;
  /** Model or route identifier, for the cost ledger and the audit trail. Never a credential. */
  readonly model: string;
  readonly capabilities: readonly string[];
  /** The NAME of a credential the adapter will look up at runtime. Never the credential itself. */
  readonly credentialRef?: string;
  /** True once the owner's commercial/credential gate has been passed for this route. */
  readonly commercialApproval: boolean;
}

/** What the runtime observed about reachability. Established by the caller, never claimed by config. */
export interface TransportAvailability {
  readonly reachable: boolean;
  /** Why not, when not — carried into the owner's choice so it is an informed one. */
  readonly detail?: string;
}

/**
 * The owner's options when no gatekeeper can be reached. These three, verbatim, because a fourth
 * option that quietly means "carry on" is exactly what must not exist.
 */
export const GATEKEEPER_UNAVAILABLE_OWNER_CHOICES = [
  'WAIT FOR OPENAI',
  'ACCEPT RISK & CONTINUE WITH CLAUDE SELF-REVIEW',
  'STOP WORK',
] as const;
export type GatekeeperUnavailableOwnerChoice = (typeof GATEKEEPER_UNAVAILABLE_OWNER_CHOICES)[number];

/**
 * WHY THE GATEKEEPER COULD NOT ANSWER, as a closed vocabulary rather than prose.
 *
 * THE LIVE PROOF FAILED ON THIS. The outage identity a degraded grant answers used to be hashed over
 * the human-readable stop reasons, and those carry ordinary check and finding state. Committing the
 * owner's own authority wrapper made one test fail, which changed the stop detail, which changed the
 * identity — so the grant the owner had just approved named an outage that no longer occurred and
 * refused itself. Correctly, and uselessly: no sequence of reissued grants converges on a moving
 * target.
 *
 * These are MATERIAL causes, and they stay distinct because risk accepted for one is not risk
 * accepted for another: an owner who accepts continuing without a reviewer because the credential is
 * not approved has not thereby accepted continuing because the provider refused on spend. The
 * wording of any cause may change freely; the identity does not move with it.
 *
 * THE ROUTE CAUSES WERE ONCE ONE VALUE, AND THAT WAS TOO COARSE. `TRANSPORT_UNAVAILABLE` covered a
 * missing descriptor, an invalid one, one the OWNER had not commercially approved, and one the
 * environment could not reach. Those are different facts about different parties — the third is a
 * governance refusal by the owner, the fourth is the network — and collapsing them meant a grant
 * accepted for one could answer another with project, phase, subject and stop all unchanged. They
 * are split because `selectGatekeeperTransport` already distinguishes them structurally, before any
 * prose is rendered; nothing here is recovered by parsing a message.
 *
 * NOT SPLIT, AND THE REASON IS STRUCTURAL: "configured but not enabled" is decided in
 * `loadGatekeeperConfig`, which folds it into an untyped reason list and refuses the whole config.
 * A disabled gatekeeper therefore never reaches this selector — the CLI refuses the run outright —
 * so there is no state here to distinguish, and inventing a value for it would be a distinction the
 * structured state cannot establish. See the report accompanying this change.
 */
export const GATEKEEPER_UNAVAILABILITY_CAUSES = [
  /** No transport descriptor at all. Nothing further about a route can even be evaluated. */
  'TRANSPORT_NOT_CONFIGURED',
  /** A descriptor exists but does not satisfy the transport contract, so it cannot be trusted. */
  'TRANSPORT_UNUSABLE',
  /** A usable route exists that the OWNER has not commercially approved. A governance refusal. */
  'TRANSPORT_NOT_APPROVED',
  /** An approved route that the environment could not reach. */
  'TRANSPORT_UNREACHABLE',
  /** A route exists and is approved, but the credential it names could not be resolved. */
  'CREDENTIAL_UNAVAILABLE',
  /** The provider itself refused on a spend limit. A budget decision, not a failure. */
  'PROVIDER_SPEND_LIMITED',
  /** The provider was tried and produced no usable decision. */
  'PROVIDER_UNAVAILABLE',
] as const;

export type GatekeeperUnavailabilityCause = (typeof GATEKEEPER_UNAVAILABILITY_CAUSES)[number];

export function isGatekeeperUnavailabilityCause(v: unknown): v is GatekeeperUnavailabilityCause {
  return typeof v === 'string' && (GATEKEEPER_UNAVAILABILITY_CAUSES as readonly string[]).includes(v);
}

export interface TransportSelected {
  readonly outcome: 'SELECTED';
  readonly transport: GatekeeperTransportDescriptor;
}

export interface TransportUnavailable {
  readonly outcome: 'UNAVAILABLE';
  /** The MATERIAL cause, which an outage identity may bind. Stable across rewording. */
  readonly cause: GatekeeperUnavailabilityCause;
  /** Every reason the configured route could not be used. Diagnostic only — never identity. */
  readonly reasons: readonly string[];
  /** The owner's explicit choice set. Never empty, never defaulted for them. */
  readonly ownerChoices: readonly GatekeeperUnavailableOwnerChoice[];
}

export type TransportSelection = TransportSelected | TransportUnavailable;

/**
 * Shapes that mean a credential leaked into configuration.
 *
 * BROADER THAN THE OPENAI CASE, because configuration files collect credentials from everywhere and a
 * scan that only knows one vendor's format gives false confidence about all the others. This is still
 * a heuristic and cannot be exhaustive — the structural control is `credentialRef`, which names a
 * secret instead of holding one. This catches the mistake, not a determined attempt.
 */
const SECRET_SHAPE = new RegExp(
  [
    'sk-[A-Za-z0-9_-]{16,}', // OpenAI classic and project keys
    'sk-ant-[A-Za-z0-9_-]{16,}', // Anthropic
    'eyJ[A-Za-z0-9_-]{20,}', // JWT / JWS header blob
    '-----BEGIN[\\s\\S]{0,64}?PRIVATE KEY-----',
    'gh[pousr]_[A-Za-z0-9]{20,}', // GitHub tokens of every current shape
    'AKIA[0-9A-Z]{12,}', // AWS access key id
    'aws_secret_access_key["\'\\s:=]{1,4}[A-Za-z0-9/+=]{40}',
    'xox[baprs]-[A-Za-z0-9-]{10,}', // Slack
    'AIza[0-9A-Za-z_-]{20,}', // Google
    '(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}', // Stripe
    'sb_secret_[A-Za-z0-9]{6,}', // Supabase
    'glpat-[A-Za-z0-9_-]{16,}', // GitLab
    'dop_v1_[a-f0-9]{32,}', // DigitalOcean
  ].join('|'),
);

/** Field names that should never hold a literal value in a descriptor. */
const CREDENTIAL_BEARING_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE|BEARER|SESSION)/i;

/**
 * Why this descriptor cannot serve as a gatekeeper transport, or `[]` when it can.
 *
 * Availability is NOT considered here — this is about whether the route is permissible at all, which
 * stays true whether or not the network is up.
 */
export function checkTransportDescriptor(
  descriptor: GatekeeperTransportDescriptor,
  opts: { readonly rehearsalOnly?: boolean } = {},
): readonly string[] {
  const errors: string[] = [];

  if (typeof descriptor.transportId !== 'string' || descriptor.transportId.trim() === '') {
    errors.push('transport has no transportId');
  }
  if (!(GATEKEEPER_TRANSPORT_KINDS as readonly string[]).includes(descriptor.kind)) {
    errors.push(
      `transport kind ${JSON.stringify(descriptor.kind)} is not one of: ${GATEKEEPER_TRANSPORT_KINDS.join(', ')}`,
    );
  }
  if (typeof descriptor.model !== 'string' || descriptor.model.trim() === '') {
    errors.push('transport names no model, so its cost cannot be attributed');
  }

  // REHEARSAL IS A PROPERTY OF THE ROUTE, NOT A FLAG THE CALLER WAVES. `rehearsalOnly` used to switch
  // off the commercial gate for ANY transport, so one boolean at one call site could have let a real
  // paid route run as if it were a local stub. The flag now only means anything for a kind that IS a
  // rehearsal, and asking for rehearsal on a real transport is itself refused.
  if (opts.rehearsalOnly === true && !REHEARSAL_ONLY_KINDS.includes(descriptor.kind)) {
    errors.push(
      `transport '${descriptor.transportId}' is of kind '${descriptor.kind}' and cannot be run in ` +
        'rehearsal mode; rehearsal exists so the plumbing can be proven without a real reviewer, not ' +
        'so a real reviewer can be treated as a stub',
    );
  }

  // A LOCAL MODEL MAY REHEARSE AND MAY NEVER REVIEW.
  if (REHEARSAL_ONLY_KINDS.includes(descriptor.kind) && opts.rehearsalOnly !== true) {
    errors.push(
      `transport kind '${descriptor.kind}' can rehearse transport plumbing but can never be the accepted ` +
        'gatekeeper, because a review run by the implementer\'s own machine is not independent oversight',
    );
  }

  // STRUCTURAL READ-ONLINESS.
  const capabilities = Array.isArray(descriptor.capabilities) ? descriptor.capabilities : null;
  if (capabilities === null) {
    errors.push('transport declares no capabilities list, so it cannot be shown to be read-only');
  } else {
    for (const capability of capabilities) {
      if (FORBIDDEN_GATEKEEPER_CAPABILITIES.includes(capability)) {
        errors.push(
          `transport declares capability '${capability}', which would let the reviewer act on the machine; ` +
            'a gatekeeper reviews and decides and does nothing else',
        );
      }
    }
    for (const required of REQUIRED_GATEKEEPER_CAPABILITIES) {
      if (!capabilities.includes(required)) {
        errors.push(`transport cannot '${required}', so it cannot carry a review`);
      }
    }
  }

  // NO CREDENTIAL MATERIAL IN CONFIGURATION. `credentialRef` names one; it never holds one.
  //
  // SCANNED AT EVERY DEPTH. The first version walked `Object.entries` once, so a key one level down —
  // `{ auth: { apiKey: 'sk-...' } }`, which is exactly how configuration files are usually shaped —
  // was never looked at. Descriptors are small, so the whole structure is walked.
  const walk = (value: unknown, path: string, depth: number): void => {
    if (depth > 6) return;
    if (typeof value === 'string') {
      if (SECRET_SHAPE.test(value)) {
        errors.push(`transport field '${path}' contains credential-shaped material and must hold only a reference`);
      }
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const key of Object.getOwnPropertyNames(value as object)) {
      const child = (value as Record<string, unknown>)[key];
      const childPath = path === '' ? key : `${path}.${key}`;
      if (childPath !== 'credentialRef' && CREDENTIAL_BEARING_NAME.test(key)) {
        errors.push(
          `transport field '${childPath}' is credential-bearing; use credentialRef to name a credential instead`,
        );
      }
      walk(child, childPath, depth + 1);
    }
  };
  walk(descriptor, '', 0);

  return errors;
}

/**
 * Choose the gatekeeper transport for this run, or refuse and hand the owner the choice.
 *
 * TAKES ONE CONFIGURED TRANSPORT, NOT A LIST. That is the design, not a limitation: a list invites a
 * loop that tries the next one, and "tried the next one" is how an unreviewed route silently becomes
 * the reviewer. Changing which transport is configured is an owner-visible configuration change.
 */
export function selectGatekeeperTransport(
  descriptor: GatekeeperTransportDescriptor | null,
  availability: TransportAvailability,
  opts: { readonly rehearsalOnly?: boolean } = {},
): TransportSelection {
  const reasons: string[] = [];
  // THE CAUSE IS DECIDED BY WHICH CHECK FAILED, IN A FIXED ORDER, so a route that is wrong in more
  // than one way still yields ONE deterministic identity. The order runs outermost-first: a missing
  // descriptor makes every later question meaningless, an untrustworthy descriptor makes approval
  // and reachability meaningless, and the owner's commercial gate is answered before the network is
  // consulted because a route the owner has not approved must not be reported as a connectivity
  // problem.
  let cause: GatekeeperUnavailabilityCause | null = null;
  const note = (c: GatekeeperUnavailabilityCause): void => {
    if (cause === null) cause = c;
  };

  if (descriptor === null) {
    note('TRANSPORT_NOT_CONFIGURED');
    reasons.push('no gatekeeper transport is configured for this project');
  } else {
    const descriptorProblems = checkTransportDescriptor(descriptor, opts);
    if (descriptorProblems.length > 0) note('TRANSPORT_UNUSABLE');
    reasons.push(...descriptorProblems);

    // The commercial gate is the owner's and is not implied by the route existing.
    if (opts.rehearsalOnly !== true && descriptor.commercialApproval !== true) {
      note('TRANSPORT_NOT_APPROVED');
      reasons.push(
        `transport '${descriptor.transportId}' has no owner commercial approval, so it may not be called; ` +
          'API activation, credential creation and spend are a separate owner gate',
      );
    }
    if (availability.reachable !== true) {
      note('TRANSPORT_UNREACHABLE');
      // THE DETAIL COMES FROM WHATEVER FAILED — a provider error body, a proxy page, a DNS message —
      // and this refusal is written into a governance record. Unbounded text from a remote party is
      // not something a record should carry verbatim, so it is truncated and stripped to printable
      // characters before it is quoted.
      const detail = typeof availability.detail === 'string' ? availability.detail : '';
      const safeDetail = Array.from(detail.replace(/[‪-‮⁦-⁩‎‏؜]/g, ''))
        .filter((ch) => ch >= ' ')
        .join('')
        .slice(0, 200);
      reasons.push(
        `transport '${descriptor.transportId}' is not reachable` +
          (safeDetail !== '' ? `: ${safeDetail}` : ''),
      );
    }
  }

  if (reasons.length > 0) {
    // NO SECOND ATTEMPT IS MADE HERE, BY DESIGN. The owner decides what happens next.
    return {
      outcome: 'UNAVAILABLE',
      // `reasons` is non-empty, so exactly one `note` has fired; the fallback names the descriptor
      // as unusable rather than inventing a friendlier cause for a state nothing accounted for.
      cause: cause ?? 'TRANSPORT_UNUSABLE',
      reasons,
      ownerChoices: GATEKEEPER_UNAVAILABLE_OWNER_CHOICES,
    };
  }
  return { outcome: 'SELECTED', transport: descriptor as GatekeeperTransportDescriptor };
}

/** Is this a choice the owner actually offered, rather than one inferred from silence? */
export function isOwnerUnavailableChoice(value: unknown): value is GatekeeperUnavailableOwnerChoice {
  return typeof value === 'string' && (GATEKEEPER_UNAVAILABLE_OWNER_CHOICES as readonly string[]).includes(value);
}
