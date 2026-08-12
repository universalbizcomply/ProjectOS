#!/usr/bin/env node
/**
 * THE release payload pipeline, in the only order that is safe.
 *
 *   build the daemon bundle
 *     -> assemble the closed runtime payload (pinned runtime + that bundle)
 *     -> dependency closure MUST PASS
 *     -> generate the unsigned trust manifest and its canonical signing bytes
 *
 * Tauri then packages exactly those bytes. Nothing here is optional and nothing is skippable: the
 * generator refuses to write a manifest for a payload that did not pass closure, and this script
 * fails if the generator fails.
 *
 * WHY IT EXISTS. `tauri build` used to reference build output that a developer had to produce by
 * hand first, so a fresh checkout could not package at all and the bundle contents depended on
 * whatever happened to be lying around. The release build now generates its own inputs, in order,
 * from source — that is the difference between a reproducible package and a lucky one.
 *
 * IT INSTALLS NOTHING. It writes into `dist-payload/` inside this package and stops.
 *
 * Created in PROJECTOS-RECOVERY-INSTALLED-APP1A (installer trust record + release candidate).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTROL_CENTER = resolve(HERE, '..');
const PROJECTOS_ROOT = resolve(CONTROL_CENTER, '..');
const GENERATOR = join(PROJECTOS_ROOT, 'host', 'packaged-manifest-generator');

/** Where the payload is staged. Tauri maps this directory to `runtime-payload/` beside the exe. */
const PAYLOAD_OUT = join(CONTROL_CENTER, 'dist-payload');

/**
 * The installer-owned installation record, and the WiX fragment that installs it.
 *
 * Both are build output. The record's CONTENT comes from the canonical model via
 * `projectos-install-record`; the fragment is expanded from a committed template with the record's
 * absolute path substituted, because WiX resolves a File Source against candle's working directory
 * rather than the .wxs location and that directory is Tauri's to choose, not ours.
 */
const RECORD_OUT = join(CONTROL_CENTER, 'dist-installer', 'application.v1.json');
const FRAGMENT_TEMPLATE = join(HERE, 'installation-record.wxs.template');
const FRAGMENT_OUT = join(CONTROL_CENTER, 'src-tauri', 'generated', 'installation-record.wxs');

/**
 * THE INSTALL ROOT THE RECORD DESCRIBES.
 *
 * It must equal where the MSI actually installs, because the runtime compares the record's
 * installRoot against `current_exe().parent()` and refuses a mismatch. This is the MSI's DEFAULT
 * INSTALLDIR: ProgramFiles64Folder + the Tauri productName.
 *
 * A STATIC RECORD IS ONLY SAFE BECAUSE THE INSTALL ROOT IS FIXED. Tauri's stock installer uses
 * WixUI_InstallDir with ConfigurableDirectory="INSTALLDIR", so a user could pick another directory
 * and receive an installation the runtime silently refuses - a choice the product offers and then
 * rejects. `packaging/wix/main.wxs` overrides that template to remove the choice: WixUI_Minimal
 * (which does not CONTAIN a directory dialog), no ConfigurableDirectory, and no registry search that
 * could relocate the install. The removal is verified from the built MSI's own Dialog, Control,
 * Feature and AppSearch tables in packaging/INSTALLER-EFFECT-MANIFEST.txt.
 *
 * WHAT REMAINS, stated rather than hidden.
 *
 * 1. An administrator can still pass INSTALLDIR=... to msiexec directly. That is not defended
 *    against, and it does not need to be - such an install records this root, installs elsewhere,
 *    and the runtime refuses to launch it. Loud and closed.
 *
 * 2. KNOWN LIMITATION - THE DRIVE LETTER IS ASSUMED. This literal says `C:`, but WiX resolves
 *    INSTALLDIR from ProgramFiles64Folder, which follows the drive Windows is installed on. On a
 *    machine where that is not C:, the MSI installs to e.g. `D:\Program Files\...` while this
 *    record still says `C:\...`, and the runtime refuses a LEGITIMATE, untampered installation.
 *    It fails closed rather than open, so it is a reliability defect and not a security one - but
 *    it is a real installation path this MSI permits and ProjectOS would refuse, which is the
 *    thing this whole increment exists to prevent.
 *
 *    IT CANNOT BE FIXED HERE. The record is composed ONCE at build time and shipped as a static
 *    file; the target machine's system drive is not knowable then. Closing it needs the record
 *    composed at INSTALL time from the resolved INSTALLDIR - a custom action, which is a larger
 *    mechanism than this increment authorises and which must be an owner decision, because a
 *    custom action that writes the trust-adjacent record is exactly the kind of thing that should
 *    not be introduced quietly. Recorded for that decision rather than worked around.
 */
const PRODUCT_NAME = JSON.parse(
  readFileSync(join(CONTROL_CENTER, 'src-tauri', 'tauri.conf.json'), 'utf8'),
).productName;
const DEFAULT_INSTALL_ROOT = `C:\\Program Files\\${PRODUCT_NAME}`;

/** The governed ProjectOS SYSTEM root, from the project configuration rather than invented here. */
const GOVERNED_SYSTEM_ROOT = (() => {
  const explicit = process.env.PROJECTOS_GOVERNED_SYSTEM_ROOT;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const config = JSON.parse(
    readFileSync(join(PROJECTOS_ROOT, '..', '.projectops', 'project-config.json'), 'utf8'),
  );
  // `localPath` is the ProjectOS local framework repository - the SYSTEM root, not a selected
  // product repository. Normalised to Windows separators because the record is compared as a path.
  return String(config.localPath).replace(/\//g, '\\');
})();
const DAEMON_BUNDLE = join(CONTROL_CENTER, 'dist-daemon', 'projectos-daemon.mjs');

/** The application version, from the ONE place Tauri stamps it. */
const APP_VERSION = JSON.parse(
  readFileSync(join(CONTROL_CENTER, 'src-tauri', 'tauri.conf.json'), 'utf8'),
).version;

/**
 * Run a build tool with its arguments passed as an ARRAY, never through a shell.
 *
 * NO `npm`, AND NO `shell: true`. Both were tried and both are wrong here. A shell on Windows
 * concatenates the arguments into one command line, so an absolute path containing a space or an `&`
 * stops being one argument — and these are developer-machine paths, which routinely contain both.
 * Without a shell, Node refuses to spawn a `.cmd` at all, which is what `npm` is on Windows.
 *
 * So the pipeline calls the real programs: this Node for the JavaScript steps, and `cargo` — a true
 * executable — for the Rust one. Fewer layers, no quoting, and the steps are visible rather than
 * hidden behind script names.
 */
function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

/** Run a JavaScript entry point with the Node that is running this script. */
function runNode(script, args, cwd) {
  run(process.execPath, [script, ...args], cwd);
}

/**
 * The build id ties the payload to the source it came from. A dirty tree is labelled as such rather
 * than silently attributed to a clean commit.
 */
function buildId() {
  const explicit = RELEASE.buildId;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  try {
    const commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: PROJECTOS_ROOT,
      encoding: 'utf8',
    }).trim();
    const dirty =
      execFileSync('git', ['status', '--porcelain'], { cwd: PROJECTOS_ROOT, encoding: 'utf8' })
        .trim().length > 0;
    return dirty ? `${commit}-dirty` : commit;
  } catch {
    return 'unknown-source';
  }
}

/**
 * The generation timestamp. Supplied rather than taken from a clock inside the generator, and
 * overridable so a reproducible build can pin it.
 */
function generatedAt() {
  const explicit = RELEASE.generatedAt;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  // A wall clock is correct ONLY for a development payload nobody will sign. Every release mode
  // pins this, enforced above, because an unpinned timestamp makes the signed subject unrepeatable.
  return new Date().toISOString().replace(/\.\d+Z$/, '.000Z');
}

/**
 * THE PRODUCTION SIGNING CEREMONY, and why this exists.
 *
 * The owner signs the canonical manifest bytes on a machine ProjectOS never touches, and hands back
 * two PUBLIC artefacts: a public key and a detached signature. Those bytes are the subject. Three
 * fields inside them - `signingKeyId`, `buildId` and `generatedAt` - mean the subject is only
 * reproducible if all three are pinned. `generatedAt` defaults to a wall clock, so without pinning,
 * every regeneration produces a different subject and any signature over the previous one is dead.
 *
 * THE FAILURE THIS CLOSES. `tauri build` runs `release:prepare`, which runs this script, which wipes
 * `dist-payload` and regenerates. An externally attached signature was therefore erased by the very
 * build that was supposed to ship it. The fix is not to stop regenerating - it is to make
 * regeneration BYTE-IDENTICAL and then re-attach, so the build reproduces exactly the subject the
 * owner signed and refuses if it cannot.
 *
 * WHAT NEVER ENTERS. No private key, no key store, no signing. This reads a public key and a
 * detached signature from disk and hands them to `projectos-manifest-sign`, which has no private-key
 * input to give it. Signing stays outside ProjectOS.
 */
const RELEASE = (() => {
  const get = (name) => {
    const v = process.env[name];
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  const inputs = {
    keyId: get('PROJECTOS_SIGNING_KEY_ID'),
    buildId: get('PROJECTOS_BUILD_ID'),
    generatedAt: get('PROJECTOS_GENERATED_AT'),
    publicKeyFile: get('PROJECTOS_PUBLIC_KEY_FILE'),
    signatureFile: get('PROJECTOS_SIGNATURE_FILE'),
    canonicalSha256: get('PROJECTOS_CANONICAL_SHA256'),
  };
  // WHAT MAKES A RUN A RELEASE. Naming a signing key, or supplying signature material, is the
  // declaration of intent. Pinning only the build id or only the timestamp is NOT: those were
  // independently overridable before this contract existed, and a labelled reproducible development
  // payload is a legitimate thing to want. Gating them behind the release rules would have quietly
  // removed a capability while fixing an unrelated defect.
  const RELEASE_INTENT = ['keyId', 'publicKeyFile', 'signatureFile'];
  const declaresRelease = RELEASE_INTENT.some((k) => inputs[k] !== null);
  if (!declaresRelease) return { mode: 'development', ...inputs };

  // FAIL CLOSED ON PARTIAL INPUT. A release run that fell back to a wall clock or a placeholder key
  // id would produce something that looks like a release candidate and can never be signed - the
  // exact defect that wasted the first ceremony. Anything incomplete stops here and says what is
  // missing, because all three of these fields are inside the bytes the owner signs.
  const supplied = Object.entries(inputs).filter(([, v]) => v !== null).map(([k]) => k);
  const missing = ['keyId', 'buildId', 'generatedAt'].filter((k) => inputs[k] === null);
  if (missing.length > 0) {
    throw new Error(
      `release signing inputs are incomplete: ${supplied.join(', ')} supplied but ` +
        `${missing.join(', ')} missing. A reproducible subject needs the signing key id, the ` +
        'build id and the generated-at timestamp pinned together, because all three are inside ' +
        'the signed bytes.',
    );
  }
  if (inputs.keyId.includes('unprovisioned') || inputs.keyId.includes('placeholder')) {
    throw new Error(
      `a release subject may not name the placeholder key id "${inputs.keyId}"; ` +
        'the manifest would declare a signer no build can ever anchor',
    );
  }
  // The signature half is optional: preparing the subject FOR signing is a legitimate release run.
  // But a public key without a signature, or the reverse, is always a mistake.
  const hasPub = inputs.publicKeyFile !== null;
  const hasSig = inputs.signatureFile !== null;
  if (hasPub !== hasSig) {
    throw new Error(
      'a detached signature and its public key must be supplied together; ' +
        `got ${hasPub ? 'public key only' : 'signature only'}`,
    );
  }
  // The expected subject digest is REQUIRED once a signature is in play. Without it the drift
  // check silently does not run, and a rebuild whose bytes moved fails later with a signature
  // error instead of the honest cause. The cryptography still fails closed either way — this is
  // about the build telling the truth about WHY, which is what makes a ceremony repeatable.
  if (hasSig && inputs.canonicalSha256 === null) {
    throw new Error(
      'PROJECTOS_CANONICAL_SHA256 is required when attaching a detached signature: the build ' +
        'must confirm it reproduced the exact subject the owner signed before accepting a ' +
        'signature for it',
    );
  }
  return { mode: hasSig ? 'release-signed' : 'release-subject', ...inputs };
})();

console.log('ProjectOS release payload');
console.log(`  mode                : ${RELEASE.mode}`);
console.log(`  application version : ${APP_VERSION}`);

// ---- 1. the daemon bundle -----------------------------------------------------------------------
// The two steps `build:daemon-bundle` performs, called directly: transpile the sidecar's TypeScript,
// then link everything into ONE closed artefact.
runNode(
  join(CONTROL_CENTER, 'node_modules', 'typescript', 'bin', 'tsc'),
  ['-p', 'tsconfig.node.json'],
  CONTROL_CENTER,
);
runNode(join(HERE, 'build-daemon-bundle.mjs'), [], CONTROL_CENTER);
if (!existsSync(DAEMON_BUNDLE)) {
  console.error(`build-release-payload: the daemon bundle was not produced at ${DAEMON_BUNDLE}`);
  process.exit(1);
}

// ---- 2-4. assemble, closure, manifest ------------------------------------------------------------
// The payload root must be fresh: the assembler refuses a non-empty directory, because a stale file
// left behind would travel into the installation unattested.
rmSync(PAYLOAD_OUT, { recursive: true, force: true });
mkdirSync(PAYLOAD_OUT, { recursive: true });

run(
  'cargo',
  [
    'run',
    '--quiet',
    '--release',
    '--manifest-path',
    join(GENERATOR, 'Cargo.toml'),
    '--bin',
    'projectos-manifest-gen',
    '--',
    '--daemon-bundle',
    DAEMON_BUNDLE,
    '--out',
    PAYLOAD_OUT,
    '--application-version',
    APP_VERSION,
    '--build-id',
    buildId(),
    // The key that WILL sign this, named BEFORE canonicalisation because `signingKeyId` is inside
    // the signed bytes. Naming it afterwards is what invalidated the first ceremony's signature.
    '--signing-key-id',
    RELEASE.keyId ?? 'projectos-signing-unprovisioned',
    '--generated-at',
    generatedAt(),
  ],
  PROJECTOS_ROOT,
);

// ---- 4b. the owner's detached signature, verified and attached ----------------------------------
//
// This runs AFTER generation on purpose. The generator emits the manifest unsigned and writes the
// canonical bytes; only then is there a subject to check a signature against. Attachment goes
// through `projectos-manifest-sign`, which verifies before writing and refuses if attaching would
// change the canonical bytes - so a signature can never end up stored against bytes it does not
// cover. There is no private-key path here because that tool has no private-key input.
{
  const canonicalPath = join(PAYLOAD_OUT, 'projectos-trust-manifest.canonical');
  const canonical = readFileSync(canonicalPath);
  const actualSha = createHash('sha256').update(canonical).digest('hex');
  console.log(`canonical subject   : ${canonical.length} bytes, sha256 ${actualSha}`);

  // THE SUBJECT MUST BE THE ONE THAT WAS SIGNED. Checked before the signature is even read, so a
  // drifted build fails on the honest cause - the bytes moved - rather than on a confusing
  // signature error. This is what makes the regenerate-then-reattach sequence safe.
  if (RELEASE.canonicalSha256 && RELEASE.canonicalSha256 !== actualSha) {
    throw new Error(
      `the regenerated canonical subject is not the one that was signed.\n` +
        `  expected sha256: ${RELEASE.canonicalSha256}\n` +
        `  actual   sha256: ${actualSha}\n` +
        'Refusing to attach a signature to different bytes. Check that the signing key id, ' +
        'build id and generated-at inputs match the ceremony exactly.',
    );
  }

  if (RELEASE.mode === 'release-signed') {
    // THE SIGNATURE MUST BE CHECKED AGAINST THE KEY THE APPLICATION ACTUALLY EMBEDS.
    //
    // `projectos-manifest-sign verify` checks against whatever public key it is handed. Handing it
    // the same file that was used to attach is self-consistent by construction: any key pair would
    // pass, print "VERIFIED", and exit 0 — while the shipped binary, which only ever verifies
    // against its compiled-in anchor, would refuse the result at launch. That is not a trust hole
    // (the embedded anchor is the only thing that decides trust), but it is a whole release cycle
    // spent to discover a wrong key. This increment exists because one ceremony was already lost
    // that way, so the wrong key must fail HERE, loudly, before anything is packaged.
    const anchorSrc = readFileSync(
      join(PROJECTOS_ROOT, 'host', 'host-identity', 'src', 'identity', 'anchor.rs'),
      'utf8',
    );
    const production = anchorSrc.slice(0, anchorSrc.indexOf('#[cfg(test)]') + 1 || undefined);
    const pointMatch = production.match(/const OWNER_PUBLIC_POINT[\s\S]*?=\s*\[([\s\S]*?)\];/);
    const keyIdMatch = production.match(/PRODUCTION_KEY_ID:\s*&str\s*=\s*"([^"]+)"/);
    if (!pointMatch || !keyIdMatch) {
      throw new Error('cannot read the embedded production anchor from anchor.rs');
    }
    const embeddedPoint = Buffer.from(
      pointMatch[1].match(/0x[0-9a-fA-F]{2}/g).map((h) => parseInt(h, 16)),
    ).toString('hex');
    const suppliedPoint = readFileSync(RELEASE.publicKeyFile, 'utf8').trim().toLowerCase();

    if (suppliedPoint !== embeddedPoint) {
      throw new Error(
        'the supplied public key is not the key this build embeds.\n' +
          `  embedded anchor: ${embeddedPoint}\n` +
          `  supplied key   : ${suppliedPoint}\n` +
          'A signature verified against a key the application does not trust would package a ' +
          'release the shipped binary refuses at launch.',
      );
    }
    if (RELEASE.keyId !== keyIdMatch[1]) {
      throw new Error(
        `the signing key id "${RELEASE.keyId}" is not the embedded anchor's ` +
          `"${keyIdMatch[1]}"; the manifest would name a signer this build cannot verify`,
      );
    }
    console.log(`anchor match        : supplied key IS the embedded anchor (${keyIdMatch[1]})`);

    const sign = (args) =>
      run(
        'cargo',
        [
          'run', '--quiet', '--release',
          '--manifest-path', join(GENERATOR, 'Cargo.toml'),
          '--bin', 'projectos-manifest-sign',
          '--', ...args,
        ],
        PROJECTOS_ROOT,
      );
    sign([
      'attach',
      '--payload', PAYLOAD_OUT,
      '--signature', `@${RELEASE.signatureFile}`,
      '--public-key', `@${RELEASE.publicKeyFile}`,
      '--signing-key-id', RELEASE.keyId,
    ]);
    // Verify what was just written, through the same interface a reviewer would use. Attaching and
    // trusting the attach is not a proof; reading it back is.
    sign(['verify', '--payload', PAYLOAD_OUT, '--public-key', `@${RELEASE.publicKeyFile}`]);

    const after = createHash('sha256')
      .update(readFileSync(canonicalPath))
      .digest('hex');
    if (after !== actualSha) {
      throw new Error('attaching the signature changed the canonical bytes — refusing');
    }
    console.log('manifest signature  : ATTACHED and VERIFIED');
  } else {
    console.log('manifest signature  : none (unsigned payload)');
  }
}

// ---- 5. the installer-owned installation record, and the fragment that installs it -------------
rmSync(join(CONTROL_CENTER, 'dist-installer'), { recursive: true, force: true });
run(
  'cargo',
  [
    'run', '--quiet', '--release',
    '--manifest-path', join(GENERATOR, 'Cargo.toml'),
    '--bin', 'projectos-install-record',
    '--',
    '--out', RECORD_OUT,
    '--application-version', APP_VERSION,
    '--install-root', DEFAULT_INSTALL_ROOT,
    '--governed-system-root', GOVERNED_SYSTEM_ROOT,
    '--installation-id', `projectos-${buildId()}`,
  ],
  PROJECTOS_ROOT,
);

mkdirSync(dirname(FRAGMENT_OUT), { recursive: true });
writeFileSync(
  FRAGMENT_OUT,
  // replaceAll, with a FUNCTION replacement, and both halves matter. `replace` substitutes only the
  // FIRST occurrence — which was the one in the template's own comment describing the placeholder,
  // leaving the real Source attribute untouched and the build failing on a literal '@RECORD_SOURCE@'.
  // The function form also stops `$` sequences in a Windows path being read as replacement patterns.
  readFileSync(FRAGMENT_TEMPLATE, 'utf8').replaceAll('@RECORD_SOURCE@', () => RECORD_OUT),
  'utf8',
);
console.log(`installer fragment  : ${FRAGMENT_OUT}`);

console.log('');
console.log(`release payload ready: ${PAYLOAD_OUT}`);
// TELL THE TRUTH ABOUT WHAT THIS RUN PRODUCED. This line used to be unconditional, so a
// successfully signed release printed "ATTACHED and VERIFIED" and then flatly contradicted itself
// four lines later. During a signing ceremony that is exactly the message an operator relies on.
if (RELEASE.mode === 'release-signed') {
  console.log('PROJECTOS MANIFEST TRUST: SIGNED and VERIFIED against the embedded anchor.');
  console.log('Authenticode is a SEPARATE matter and is NOT addressed here.');
} else {
  console.log('NOT PRODUCTION-TRUSTED — the manifest is UNSIGNED and the owner signing gate is pending.');
}
