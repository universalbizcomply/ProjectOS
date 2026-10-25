# Host attestation — the gatekeeper execution-closure trust manifest (v2)

RUN-TO-COMPLETION HOST ATTESTATION. Candidate material for an owner signing gate. **Nothing here is
signed.** The signature field of the generated manifest is empty, and the owner key
`projectos-signing-20260812` was not used, read or referenced beyond its identifier.

## Why version 2 exists

A paid provider call is decided by three ProjectOS-controlled inputs, not one:

| Artefact | What it decides |
|---|---|
| `projectos/security/gatekeeper-transport-broker.cjs` | the trusted-side program itself |
| `projectos/security/installation-project-allowlist.json` | which projects this installation will spend on |
| `projectos/credentials/windows-credential-store.ps1` | how the credential is resolved from the Windows Credential Manager |

Their only integrity control today is the committed-bytes reader: the caller pulls the broker out of
the installation's git object store, pins the trusted install root into the source, and executes
exactly the bytes it read via `node -e`; the broker then reads the other two through the same reader.
That control is real and it is untouched by this change — the thing verified is literally the thing
that runs, so there is no verify-then-spawn window.

What it cannot do is tell a genuine commit from an **approved** one. Anyone who can commit satisfies
it. Manifest version 2 adds the second witness: an owner-signed digest over all three, alongside the
runtime and daemon the manifest already covered.

**Both witnesses, never one instead of the other.** Git alone cannot establish owner approval; a
digest alone cannot establish what actually executed.

## Attested, not packaged

None of the three is copied into the payload, and the manifest does not claim otherwise. They live in
`executionClosure`, whose members carry `repositoryRelativePath` — a git pathspec — rather than the
payload-relative `relativePath` that `runtime` and `daemonArtefact` use. Copying them would create a
second copy whose relationship to the executed bytes is unproven: the manifest would then attest
bytes nobody runs, which is worse than attesting nothing because it looks like coverage.

## The closure check proves the signature itself

`verify_execution_closure` takes the policy and the signature verifier and establishes the owner
signature over the whole subject **before** it compares a single digest. Taking a bare manifest was a
hazard the security review named: a future integration could have parsed a manifest and passed it
straight in, and an attacker who can commit — but cannot sign — would then only need to write a
manifest whose digests match their own committed bytes. Every digest would have agreed and no
signature would ever have been consulted. The ordering is now impossible to get wrong.

Under production policy the deterministic test signer is refused, as it is for identity evaluation.

## Version compatibility

* A version 1 manifest's canonical signing bytes are **unchanged**. The field is appended last and
  omitted when absent, so every signature already made over a v1 manifest still verifies, and none of
  them silently starts covering a closure it never signed. Pinned by the frozen canonical test vector.
* A version 1 manifest can never satisfy a host-attested gatekeeper execution
  (`ExecutionClosureManifestVersionTooLow`).
* A version 2 manifest without a closure is refused (`ExecutionClosureMissing`); a version 1 manifest
  carrying one is refused too (`ExecutionClosureUnexpected`), because at v1 those fields would sit
  outside the signature and be decoration mistaken for attestation.

## External executables — prerequisites, not artefacts

The broker also needs Node, git and PowerShell. Node is the already-pinned packaged runtime; nothing
new is introduced for it. Git and PowerShell are recorded as **execution prerequisites** and are not
packaged. Neither path is declared as a constant here: the git location is already declared once in
the Control Centre launch authority, and a second literal is the drift the packaging contract exists
to prevent.

| Executable | Path | Owner | Write-capable ACEs |
|---|---|---|---|
| Git | `C:\Program Files\Git\cmd\git.exe` | `BUILTIN\Administrators` | `NT AUTHORITY\SYSTEM`, `BUILTIN\Administrators` |
| PowerShell | `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` | `NT SERVICE\TrustedInstaller` | `NT SERVICE\TrustedInstaller` |

Neither grants write to the ordinary interactive user, so neither can be substituted by the agent
identity. Refusing a caller-selected alternative is a Host-contract obligation for the phase that
implements the Host transport; it is not implemented here.

## Candidate subject

Generated twice into different directories from the same material; both runs were byte-identical.

| Field | Value |
|---|---|
| Manifest version | `2` |
| Schema version | `1` |
| Application id | `com.universalbizcomply.projectos.control` |
| Application version | `0.1.0` |
| Build id | `b231cb612c83` |
| Generated at | `2026-09-05T18:00:00.000Z` |
| Signing key id expected | `projectos-signing-20260812` |
| Runtime | `runtime/node.exe` — `58e74bf02fc5bbacc41dcb8bef089961cd5bddd37830b87784e4fc624d145d1f` |
| Daemon | `daemon/projectos-daemon.mjs` — `bda9e8e3529a8efbb0695fbcffd4a39f9fe3252933c6acc65a5524f8adac57ee` |
| Broker | `projectos/security/gatekeeper-transport-broker.cjs` — `37783a63b39063dec339805dc9f9193a3839a2e23a4c6b910862846519ca41e7` |
| Allowlist | `projectos/security/installation-project-allowlist.json` — `c63cb99864e1af6f240d2f3a87554e5a0250670c21dca38be83e3b2cb5986731` |
| Credential adapter | `projectos/credentials/windows-credential-store.ps1` — `b79bafd8bda9e8fd3b319640460ecf510379ce4f8fbb0c8431d9765daaa8a10d` |
| Canonical byte length | `1275` |
| Canonical SHA-256 | `16c40a691dae05477ab0aaa60ec69a0b2e1dd95e4d0a855752f0ca83b7c0210d` |
| Signature | ABSENT (empty) |

The three closure digests are the digests of the **committed** blobs. The repository is configured
with `core.autocrlf=false` and carries no `.gitattributes`, so `git cat-file blob HEAD:<path>` and the
working-tree file are byte-identical for all three. That is not left as an assumption: a test runs
`git cat-file blob` against the real repository and compares it to the working-tree bytes for each
artefact, so an attribute added later that rewrote these files on checkout would break the build
rather than silently split the two witnesses. Git runs in the test, never in the packaging library,
which must stay free of process lookup.

The verifier does not rely on that equality holding either: it compares the manifest against the
bytes a caller actually read from the object store, so a repository that did rewrite line endings
would produce a refusal, never a false accept.

The generator binary also refuses **before it does any work** if any of the three is uncommitted or
differs from `HEAD` in the working tree. Without that, an operator with a local edit would produce a
manifest attesting bytes that were never committed, and an owner could be asked to sign a digest
corresponding to no commit — surfacing much later as a verifier mismatch nobody could explain. The
check lives in the binary, not the packaging library, which is required to contain no process or
environment lookup. It fails closed: if git cannot be run, committedness cannot be established and
the run stops.

## Carry-forward — NOT fixed here

The packaged daemon bundle inlines the development-layout install-root arithmetic
(`resolve(here, "..", "..", "..")`, correct for `projectos/agent/dist`, wrong for
`runtime-payload/daemon`). **PACKAGING / RELEASE CARRY-FORWARD — BLOCKING BEFORE NORMAL INSTALLED
PRODUCT RELEASE.** Out of scope for this phase, which is execution-closure trust rather than runtime
packaging repair.
