#!/usr/bin/env node
/**
 * Produce THE single closed daemon artefact for a packaged ProjectOS installation.
 *
 * WHY A BUNDLE AND NOT THE TREE WE SHIP TODAY. `tauri.conf.json` currently lists
 * `../sidecar/host.mjs` and `../node-build/**` as bundle resources — a loose module tree. Production
 * identity refuses that shape (`DaemonArtefactFormat::LooseModules` cannot anchor production),
 * because hashing one file of a tree attests to a fraction of what actually executes. A single file
 * has ONE digest that covers everything the daemon runs.
 *
 * WHY esbuild AND NOT A NEW TOOL. The repository had no bundler: `npm run build:sidecar` is
 * `tsc -p tsconfig.node.json`, which transpiles to `node-build/` without linking anything. esbuild
 * was already present and version-locked at 0.21.5 as a dependency of Vite, so this reuses a tool
 * the tree already carries rather than adding a second build architecture.
 *
 * DETERMINISM. Same inputs must produce byte-identical output, or the manifest hash would move for
 * reasons unrelated to the code. Hence: no sourcemap (which embeds absolute build paths), no legal
 * comments (third-party licence blocks carry paths and change with hoisting), an explicit working
 * directory so the relative path comments esbuild emits do not depend on where npm was invoked, and
 * a fixed charset.
 *
 * WHAT THIS DOES NOT DO. It does not prove the bundle is CLOSED. A bundle can be one file and still
 * reach outside itself at runtime — through `createRequire`, a cwd-relative read, or a computed
 * dynamic import. Deciding that is the dependency-closure validator's job, and it runs against the
 * assembled payload, after this.
 *
 * Created in PROJECTOS-RECOVERY-INSTALLED-APP1A.
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTROL_CENTER = resolve(HERE, '..');
/**
 * The base esbuild labels inlined modules against.
 *
 * It is the `projectos/` tree, not the Control Centre, and that choice is load-bearing. esbuild
 * names each linked module by its path relative to this directory — in a comment, and for a
 * CommonJS module as a STRING KEY in the generated registry. Based at the Control Centre, linking
 * `validators/plan-governance-engine.cjs` would emit the key `"../../validators/…"`: a build-time
 * label, indistinguishable by any text scan from the run-time escape this increment exists to
 * remove. Based at `projectos/`, every input is beneath the base and no label needs to climb.
 *
 * This changes labels only. It has no run-time effect, and it hides nothing: an author-written path
 * string is data in the output either way, and the closure validator still sees it.
 */
const PROJECTOS_ROOT = resolve(CONTROL_CENTER, '..');

/** The daemon entry the development launch authority runs today. The packaged artefact must be the
 *  same program, linked — not a different one written for packaging. */
const ENTRY = join(CONTROL_CENTER, 'sidecar', 'host.mjs');
const OUT_DIR = join(CONTROL_CENTER, 'dist-daemon');
/** Must match `projectos-packaged-runtime-contract::DAEMON_RELATIVE_PATH`'s file name. */
const OUT_FILE = join(OUT_DIR, 'projectos-daemon.mjs');

/** The pinned runtime's major version. Kept in step with the packaging contract's Node version. */
const TARGET = 'node24';

/**
 * A `require` for the linked CommonJS modules — and ONLY for Node built-ins.
 *
 * WHY IT IS NEEDED. The canonical governance engines are CommonJS and open with `require("path")`,
 * `require("fs")`, `require("crypto")`. esbuild links them into ESM output, where `require` does not
 * exist, so it emits a shim that throws `Dynamic require of "path" is not supported`. The bundle
 * passed dependency closure and still died on its first line — closure proves nothing REACHES
 * OUTSIDE the payload, not that what is inside can run.
 *
 * WHY IT IS RESTRICTED. The documented workaround is to define `require` from `createRequire`, which
 * would hand the packaged daemon a general module loader: anything on disk, resolved at run time,
 * from a bundle whose whole point is that its code is fixed at build time and covered by a digest.
 * So this one resolves built-ins and refuses everything else. Built-ins are safe because Node
 * provides them itself — it consults them before `node_modules`, so they can never be the ambient
 * development dependency this increment removes. Anything else is exactly that, and it throws.
 *
 * The refusal is a run-time counterpart to the static closure gate, not a substitute for it.
 */
const BUILTIN_ONLY_REQUIRE = `import { createRequire as __projectosCreateRequire } from "node:module";
const __projectosNodeRequire = __projectosCreateRequire(import.meta.url);
const __projectosBuiltins = new Set(["assert","async_hooks","buffer","child_process","cluster","console","constants","crypto","dgram","dns","domain","events","fs","http","http2","https","inspector","module","net","os","path","perf_hooks","process","punycode","querystring","readline","stream","string_decoder","timers","tls","tty","url","util","v8","worker_threads","zlib"]);
const require = (id) => {
  const bare = typeof id === "string" && id.startsWith("node:") ? id.slice(5) : id;
  const root = typeof bare === "string" ? bare.split("/")[0] : bare;
  if (!__projectosBuiltins.has(root)) {
    throw new Error("PACKAGED_DAEMON_REQUIRE_REFUSED: " + String(id) + " is not a Node built-in. A packaged daemon loads no module that was not linked into it.");
  }
  return __projectosNodeRequire(bare);
};
`;

mkdirSync(OUT_DIR, { recursive: true });

const result = await build({
  entryPoints: [ENTRY],
  outfile: OUT_FILE,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: TARGET,
  // Absolute build paths must never reach the output: they would differ per machine and make the
  // artefact hash unreproducible.
  sourcemap: false,
  legalComments: 'none',
  charset: 'utf8',
  absWorkingDir: PROJECTOS_ROOT,
  banner: { js: BUILTIN_ONLY_REQUIRE },
  logLevel: 'warning',
  metafile: true,
});

const bytes = readFileSync(OUT_FILE);
const sha256 = createHash('sha256').update(bytes).digest('hex');

const inputs = Object.keys(result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].inputs ?? {});

console.log(`daemon bundle : ${OUT_FILE}`);
console.log(`bytes         : ${bytes.length}`);
console.log(`sha256        : ${sha256}`);
console.log(`linked modules: ${inputs.length}`);
console.log('NOTE: one file is not the same as a closed one. Run the dependency-closure validator.');
