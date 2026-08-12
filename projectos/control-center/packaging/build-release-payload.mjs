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
 * KNOWN LIMITATION, stated rather than hidden: Tauri's generated installer uses WixUI_InstallDir
 * with ConfigurableDirectory="INSTALLDIR", so a user CAN choose another directory. The record is
 * static, so such an installation produces a record whose installRoot does not match and the runtime
 * refuses it - fail-closed and safe, but a silent no-op for that user. Guaranteeing the invariant
 * needs either a custom action that composes the record at install time, or a template override that
 * removes the browse dialog; both are larger mechanisms than this increment authorises.
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
  const explicit = process.env.PROJECTOS_BUILD_ID;
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
  const explicit = process.env.PROJECTOS_GENERATED_AT;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  return new Date().toISOString().replace(/\.\d+Z$/, '.000Z');
}

console.log('ProjectOS release payload');
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
    // The key that WILL sign this, named but absent. The manifest is emitted unsigned; naming the
    // key id is not the same as having it, and nothing here reads key material.
    '--signing-key-id',
    process.env.PROJECTOS_SIGNING_KEY_ID ?? 'projectos-signing-unprovisioned',
    '--generated-at',
    generatedAt(),
  ],
  PROJECTOS_ROOT,
);

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
console.log('NOT PRODUCTION-TRUSTED — the manifest is UNSIGNED and the owner signing gate is pending.');
