/**
 * Which gatekeeper may be asked — and what must NOT happen when none can be.
 *
 * The interesting tests here are the ones about absence. A transport that works is easy; the failure
 * this layer exists to prevent is the run that carries on because something else answered, or because
 * nothing answered and that was read as assent.
 */
import { describe, it, expect } from 'vitest';
import {
  checkTransportDescriptor,
  selectGatekeeperTransport,
  isOwnerUnavailableChoice,
  GATEKEEPER_UNAVAILABLE_OWNER_CHOICES,
  FORBIDDEN_GATEKEEPER_CAPABILITIES,
  REQUIRED_GATEKEEPER_CAPABILITIES,
  type GatekeeperTransportDescriptor,
} from '../src/gatekeeperTransport.js';

function transport(over: Partial<GatekeeperTransportDescriptor> = {}): GatekeeperTransportDescriptor {
  return {
    transportId: 'openai-primary',
    kind: 'openai-responses',
    model: 'gpt-5.6-terra',
    capabilities: ['submit-request', 'receive-decision'],
    credentialRef: 'OPENAI_GATEKEEPER_KEY',
    commercialApproval: true,
    ...over,
  };
}

const REACHABLE = { reachable: true } as const;

describe('a permissible transport', () => {
  it('is accepted when it is read-only, approved and reachable', () => {
    expect(checkTransportDescriptor(transport())).toEqual([]);
    const selection = selectGatekeeperTransport(transport(), REACHABLE);
    expect(selection.outcome).toBe('SELECTED');
  });
});

describe('structural read-onliness', () => {
  it.each(FORBIDDEN_GATEKEEPER_CAPABILITIES)('refuses a transport that can %s', (capability) => {
    const errors = checkTransportDescriptor(
      transport({ capabilities: [...REQUIRED_GATEKEEPER_CAPABILITIES, capability] }),
    );
    expect(errors.some((e) => e.includes(`capability '${capability}'`))).toBe(true);
  });

  it.each(REQUIRED_GATEKEEPER_CAPABILITIES)('refuses a transport that cannot %s', (capability) => {
    const kept = REQUIRED_GATEKEEPER_CAPABILITIES.filter((c) => c !== capability);
    const errors = checkTransportDescriptor(transport({ capabilities: kept }));
    expect(errors).toContain(`transport cannot '${capability}', so it cannot carry a review`);
  });

  it('refuses a transport that declares no capabilities at all', () => {
    const errors = checkTransportDescriptor(transport({ capabilities: undefined as never }));
    expect(errors.some((e) => e.includes('cannot be shown to be read-only'))).toBe(true);
  });
});

describe('a local model', () => {
  it('is refused as the accepted gatekeeper', () => {
    const errors = checkTransportDescriptor(transport({ kind: 'local-rehearsal', transportId: 'local' }));
    expect(errors.some((e) => e.includes('can never be the accepted gatekeeper'))).toBe(true);
  });

  it('is permitted for rehearsal, which is what lets the loop be proven without spend', () => {
    const errors = checkTransportDescriptor(
      transport({ kind: 'local-rehearsal', transportId: 'local', commercialApproval: false }),
      { rehearsalOnly: true },
    );
    expect(errors).toEqual([]);
  });

  it('is still refused for rehearsal if it claims a mutating capability', () => {
    const errors = checkTransportDescriptor(
      transport({ kind: 'local-rehearsal', capabilities: ['submit-request', 'receive-decision', 'shell'] }),
      { rehearsalOnly: true },
    );
    expect(errors.some((e) => e.includes(`capability 'shell'`))).toBe(true);
  });

  it('refuses an unrecognised transport kind rather than trying it', () => {
    const errors = checkTransportDescriptor(transport({ kind: 'carrier-pigeon' as never }));
    expect(errors.some((e) => e.includes('is not one of'))).toBe(true);
  });
});

describe('credential material in configuration', () => {
  it('refuses a descriptor carrying a key instead of a reference', () => {
    const errors = checkTransportDescriptor(transport({ credentialRef: 'sk-abcdefghijklmnopqrstuvwxyz012345' }));
    expect(errors.some((e) => e.includes('must hold only a reference'))).toBe(true);
  });

  it('refuses a bearer token hidden in an ordinary-looking field', () => {
    const errors = checkTransportDescriptor(
      transport({ model: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' } as Partial<GatekeeperTransportDescriptor>),
    );
    expect(errors.some((e) => e.includes('credential-shaped material'))).toBe(true);
  });

  // A DESCRIPTOR IS READ FROM CONFIGURATION, SO IT CAN CARRY FIELDS THE INTERFACE NEVER DECLARED.
  // A hand-edited config with an `apiKey` beside the reference is the realistic way a secret gets
  // into this file, and the value need not look like a key for the field to be the wrong place for it.
  it('refuses a credential-bearing field even when its value looks innocuous', () => {
    const loose = { ...transport(), apiKey: 'value-from-config' } as GatekeeperTransportDescriptor;
    const errors = checkTransportDescriptor(loose);
    expect(errors).toContain(
      "transport field 'apiKey' is credential-bearing; use credentialRef to name a credential instead",
    );
  });

  it('accepts a credential named rather than embedded', () => {
    expect(checkTransportDescriptor(transport({ credentialRef: 'OPENAI_GATEKEEPER_KEY' }))).toEqual([]);
  });
});

describe('rehearsal is a property of the route, not a flag', () => {
  // ONE BOOLEAN AT ONE CALL SITE used to switch off the commercial gate for ANY transport, so a real
  // paid route could be run as if it were a local stub.
  it('refuses to run a real transport in rehearsal mode', () => {
    const errors = checkTransportDescriptor(transport(), { rehearsalOnly: true });
    expect(errors.some((e) => e.includes('cannot be run in rehearsal mode'))).toBe(true);
  });

  it('does not let the rehearsal flag bypass the commercial gate for a real transport', () => {
    const selection = selectGatekeeperTransport(
      transport({ commercialApproval: false }),
      REACHABLE,
      { rehearsalOnly: true },
    );
    expect(selection.outcome).toBe('UNAVAILABLE');
  });

  it('still permits rehearsal for a route that genuinely is one', () => {
    expect(
      checkTransportDescriptor(
        transport({ kind: 'local-rehearsal', transportId: 'local', commercialApproval: false }),
        { rehearsalOnly: true },
      ),
    ).toEqual([]);
  });
});

describe('credential material at any depth', () => {
  // THE FIRST VERSION WALKED THE TOP LEVEL ONLY, so a key one level down — which is how config files
  // are usually shaped — was never looked at.
  it('finds a key nested inside a sub-object', () => {
    const nested = { ...transport(), auth: { apiKey: 'sk-abcdefghijklmnopqrstuvwxyz012345' } } as never;
    const errors = checkTransportDescriptor(nested);
    expect(errors.some((e) => e.includes('credential-shaped material'))).toBe(true);
  });

  it('finds a credential-bearing field name nested inside a sub-object', () => {
    const nested = { ...transport(), auth: { token: 'value-from-config' } } as never;
    const errors = checkTransportDescriptor(nested);
    expect(errors.some((e) => e.includes('credential-bearing'))).toBe(true);
  });
});

describe('what a refusal quotes from a remote party', () => {
  it('truncates and strips the unreachability detail', () => {
    const selection = selectGatekeeperTransport(transport(), {
      reachable: false,
      detail: 'x'.repeat(5000) + '\u0000\u001b',
    });
    if (selection.outcome !== 'UNAVAILABLE') throw new Error('unreachable');
    const joined = selection.reasons.join(' ');
    expect(joined.length).toBeLessThan(400);
    expect(joined).not.toContain('\u0000');
  });
});

describe('the owner commercial gate', () => {
  it('refuses to call a transport that has not passed it', () => {
    const selection = selectGatekeeperTransport(transport({ commercialApproval: false }), REACHABLE);
    expect(selection.outcome).toBe('UNAVAILABLE');
    if (selection.outcome !== 'UNAVAILABLE') throw new Error('unreachable');
    expect(selection.reasons.some((r) => r.includes('separate owner gate'))).toBe(true);
  });
});

describe('when no gatekeeper can be reached', () => {
  it('refuses rather than proceeding, and hands the owner the three choices', () => {
    const selection = selectGatekeeperTransport(transport(), { reachable: false, detail: 'connection refused' });
    expect(selection.outcome).toBe('UNAVAILABLE');
    if (selection.outcome !== 'UNAVAILABLE') throw new Error('unreachable');
    expect(selection.reasons.some((r) => r.includes('connection refused'))).toBe(true);
    expect(selection.ownerChoices).toEqual([
      'WAIT FOR OPENAI',
      'ACCEPT RISK & CONTINUE WITH CLAUDE SELF-REVIEW',
      'STOP WORK',
    ]);
  });

  it('refuses when nothing is configured at all', () => {
    const selection = selectGatekeeperTransport(null, REACHABLE);
    expect(selection.outcome).toBe('UNAVAILABLE');
    if (selection.outcome !== 'UNAVAILABLE') throw new Error('unreachable');
    expect(selection.reasons).toContain('no gatekeeper transport is configured for this project');
    expect(selection.ownerChoices.length).toBe(3);
  });

  // NO SILENT FALLBACK. The selector takes ONE transport, so there is no list to walk and no second
  // route to slide onto.
  //
  // THE ARITY ASSERTION THIS REPLACES WAS VACUOUS: `selectGatekeeperTransport.length` counts
  // parameters before the first default, so it stayed at 2 whatever the parameter TYPES became — an
  // array-accepting version would have passed it unchanged. What actually pins the property is that
  // handing it a list is a type error and, at runtime, produces a refusal rather than a walk.
  it('never substitutes another transport, because it cannot be given a list', () => {
    const working = transport();
    const alternative = transport({ transportId: 'codex-secondary', kind: 'codex-cli' });
    const selection = selectGatekeeperTransport(
      [working, alternative] as unknown as GatekeeperTransportDescriptor,
      { reachable: false },
    );
    expect(selection.outcome).toBe('UNAVAILABLE');
    if (selection.outcome !== 'UNAVAILABLE') throw new Error('unreachable');
    // It refused the malformed input; it did not quietly select either member of the list.
    expect(selection.reasons.length).toBeGreaterThan(0);
  });

  it('recognises only the choices the owner was actually offered', () => {
    for (const choice of GATEKEEPER_UNAVAILABLE_OWNER_CHOICES) {
      expect(isOwnerUnavailableChoice(choice)).toBe(true);
    }
    expect(isOwnerUnavailableChoice('CONTINUE')).toBe(false);
    expect(isOwnerUnavailableChoice('')).toBe(false);
    expect(isOwnerUnavailableChoice(undefined)).toBe(false);
  });

  it('reports every reason at once so one refusal shows the whole gap', () => {
    const selection = selectGatekeeperTransport(
      transport({ commercialApproval: false, capabilities: ['submit-request', 'push'] }),
      { reachable: false },
    );
    if (selection.outcome !== 'UNAVAILABLE') throw new Error('unreachable');
    expect(selection.reasons.length).toBeGreaterThanOrEqual(4);
  });
});
