'use strict';
/**
 * WHAT THE PROOF STANDS ON, AND WHAT STANDS BEHIND THE CSP — PROJECTOS-TENANT-CSP1A.
 *
 * THE MANIFEST. Tauri lets the window call any app command, because the app defines no command manifest,
 * and no command checks its caller. So script running in the window can call all of them, and the CSP is what
 * keeps script out. This names each one, so the size of that barrier's job is written down. Rule CSP-25 holds
 * it equal to `generate_handler!` in app.rs: a new command fails until someone says what it does.
 *
 * THE SURFACE. The hash the webview evidence is bound to, beside the policy and the capability. It covers what
 * the proof depends on: which Tauri modules the frontend imports, which commands exist, the build scripts and
 * the page shell. It does not cover every source file on purpose. That would turn each UI commit red until a
 * webview rerun, and a check that is always red gets ignored. Rules CSP-10 to CSP-12 judge the rest on every run.
 */
const crypto = require('crypto');

/** `ownerStep`: what a person must do before it acts, whatever script asked. */
const COMMAND_MANIFEST = [
  { command: 'daemon_request_snapshot', effect: 'read', callerCheck: false, ownerStep: 'none' },
  { command: 'daemon_governed_command', effect: 'forwards a verb to the sidecar, which validates it', callerCheck: false, ownerStep: 'none' },
  { command: 'daemon_status', effect: 'read', callerCheck: false, ownerStep: 'none' },
  { command: 'identity_status', effect: 'read', callerCheck: false, ownerStep: 'none' },
  { command: 'installed_host_status', effect: 'read', callerCheck: false, ownerStep: 'none' },
  { command: 'register_project', effect: 'writes the protected registry through an elevated helper', callerCheck: false, ownerStep: 'UAC prompt' },
  { command: 'set_credential', effect: 'writes a credential', callerCheck: false, ownerStep: 'none' },
  { command: 'pick_folder', effect: 'read', callerCheck: false, ownerStep: 'native dialog' },
  { command: 'pick_file', effect: 'read', callerCheck: false, ownerStep: 'native dialog' },
  { command: 'inspect_folder', effect: 'reads a named folder', callerCheck: false, ownerStep: 'none' },
  { command: 'prepare_folder', effect: 'adds files to a named folder', callerCheck: false, ownerStep: 'none' },
  { command: 'import_project_file', effect: 'copies a file into a registered project', callerCheck: false, ownerStep: 'none' },
  { command: 'list_project_files', effect: 'read', callerCheck: false, ownerStep: 'none' },
];

/** The commands app.rs really registers, by their last path segment. */
function registeredCommands(appRs) {
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(appRs);
  if (block === null) return [];
  return block[1].split(',').map((item) => item.trim().split('::').pop()).filter(Boolean);
}

/** @param {{ appRs: string, sources: string[], packageJson: string, indexHtml: string }} input */
function frontendSurface({ appRs, sources, packageJson, indexHtml }) {
  const modules = sources.flatMap((text) => [...text.matchAll(/['"](@tauri-apps\/[^'"]+)['"]/g)].map((match) => match[1]));
  const { scripts } = JSON.parse(packageJson);
  return {
    tauriModules: [...new Set(modules)].sort(),
    commands: registeredCommands(appRs).sort(),
    buildScripts: { build: scripts.build, 'build:renderer': scripts['build:renderer'] },
    indexHtmlSha256: crypto.createHash('sha256').update(indexHtml).digest('hex'),
  };
}

function surfaceHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify(frontendSurface(input))).digest('hex');
}

module.exports = { COMMAND_MANIFEST, registeredCommands, frontendSurface, surfaceHash };
