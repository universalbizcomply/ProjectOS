/**
 * THE CROSS-LANGUAGE PIN, from the TypeScript side.
 *
 * This file and `projectos/host/host-identity/tests/canonical_vectors.rs` read the SAME committed
 * vector file and assert against the SAME values. Neither language keeps its own table of expected
 * digests, because two tables that agree today are still two contracts.
 *
 * Created in PROJECTOS-HOST-REVIEW-PATH1A.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMMITTED_CANDIDATE_DOMAIN,
  COMMITTED_CANDIDATE_SCHEMA_VERSION,
  PROGRAMME_IDENTITY_DOMAIN,
  committedCandidateDigest,
  credentialRefIdentityDigest,
  isCanonicalCommitOid,
  modelPolicyIdentityDigest,
  phaseIdentityDigest,
  planIdentityDigest,
  projectIdentityDigest,
  repositoryIdentityDigest,
} from '../src/hostIdentityDigests.js';

/** Resolved from this file, never from a working directory: a test that depends on where it was
 *  launched from is a test that can pass for the wrong reason. */
const VECTORS = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'host-identity-vectors.v1.json'), 'utf8'),
) as {
  programmeIdentity: { domain: string; vectors: { field: string; value: string; digest: string }[] };
  committedCandidate: {
    domain: string;
    schemaVersion: number;
    accepted: { label: string; commitOid: string; digest: string }[];
    refused: { label: string; commitOid: string }[];
  };
};

const HELPERS: Record<string, (v: string) => Buffer> = {
  project: projectIdentityDigest,
  repository: repositoryIdentityDigest,
  plan: planIdentityDigest,
  phase: phaseIdentityDigest,
  'model-policy': modelPolicyIdentityDigest,
  'credential-ref': credentialRefIdentityDigest,
};

describe('the canonical identity digests agree with the host', () => {
  it('declares the same domains the contract file does', () => {
    expect(PROGRAMME_IDENTITY_DOMAIN).toBe(VECTORS.programmeIdentity.domain);
    expect(COMMITTED_CANDIDATE_DOMAIN).toBe(VECTORS.committedCandidate.domain);
    expect(COMMITTED_CANDIDATE_SCHEMA_VERSION).toBe(VECTORS.committedCandidate.schemaVersion);
  });

  it('produces every pinned programme-identity digest', () => {
    expect(VECTORS.programmeIdentity.vectors).toHaveLength(6);
    for (const row of VECTORS.programmeIdentity.vectors) {
      const helper = HELPERS[row.field];
      // A tag pinned in the contract with no helper here is a silent hole in the pin, so it fails.
      expect(helper, `no typed helper claims field '${row.field}'`).toBeTypeOf('function');
      expect(helper!(row.value).toString('hex'), `field '${row.field}' drifted`).toBe(row.digest);
    }
  });

  it('keeps every field tag in its own digest space', () => {
    const same = 'identical-text';
    const all = Object.values(HELPERS).map((h) => h(same).toString('hex'));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('the committed-candidate contract', () => {
  it('produces every accepted vector', () => {
    expect(VECTORS.committedCandidate.accepted.length).toBeGreaterThan(0);
    for (const row of VECTORS.committedCandidate.accepted) {
      expect(isCanonicalCommitOid(row.commitOid)).toBe(true);
      const d = committedCandidateDigest(row.commitOid);
      expect(d, `${row.label} must produce a digest`).not.toBeNull();
      expect(d!.toString('hex'), `${row.label} drifted`).toBe(row.digest);
    }
  });

  it('refuses every refused vector, and digests none of them', () => {
    for (const row of VECTORS.committedCandidate.refused) {
      expect(isCanonicalCommitOid(row.commitOid), `${row.label} must not be canonical`).toBe(false);
      expect(committedCandidateDigest(row.commitOid), `${row.label} must be refused`).toBeNull();
    }
  });

  it('refuses a non-string where a commit oid is required', () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(isCanonicalCommitOid(bad)).toBe(false);
    }
  });
});
