/**
 * The Criterion 10 proof target.
 *
 * WHY A TEST EXISTS THAT ASSERTS A CONSTANT. Acceptance criterion 10 requires a correction cycle
 * driven by a REAL mandatory check failing — not a described failure, not a prose one. Something must
 * therefore be safely breakable, and the safest breakable thing is a value that means nothing to the
 * running system. This fixture has no runtime authority, no credential behaviour and no budget
 * behaviour: breaking it fails `agent-tests`, which is a mandatory configured check, and nothing else.
 *
 * IT IS ALSO THE WHOLE OF THE CORRECTION WORKER'S WRITE AUTHORITY. The autonomous worker may write
 * this one file and nothing else — not runner.ts, not workers.ts, not outcome.ts, not
 * correctionBoundary.ts. A worker that could edit those could widen or reset its own limits.
 */
import { describe, it, expect } from 'vitest';
import fixture from './fixtures/correction-proof-fixture.json' with { type: 'json' };

describe('the correction proof fixture', () => {
  it('holds the expected answer', () => {
    expect(fixture.expectedAnswer).toBe(42);
  });

  it('is the only file the correction worker may write', () => {
    expect(fixture.schemaVersion).toBe('1.0.0');
  });
});
