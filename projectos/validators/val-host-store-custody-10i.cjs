"use strict";
// RUN-TO-COMPLETION HOST ATTESTATION §10I — FIRST-START DURABLE STORE CUSTODY.
//
// Fails closed. Proves the Host's two durable stores are governed by ONE committed descriptor from
// the moment they exist, and that nothing re-secures, adopts or bypasses:
//   S1 the committed store policy is composed ONCE, in the frozen plan: the service principal owns
//      and holds Modify (never FullControl), OWNER RIGHTS holds ReadAttributes, and the policy is the
//      closed strict one;
//   S2 the ACL crate's governed creation is privilege-free and create-only: the owner must be the
//      calling account on a non-impersonating thread, files are CREATE_NEW, the DACL is protected,
//      and neither creation path reaches the SeRestorePrivilege window or an apply call;
//   S3 the trusted-roots custody composes through the frozen plan for a RESOLVED service SID, states
//      no policy of its own, creates-then-judges in that order, and never re-secures;
//   S4 the durable engine routes EVERY creation site through its creation hook: no create_dir_all,
//      OpenOptions or File::create remains in the store or the atomic writer;
//   S5 both Host stores open through the shared governed open — custody, then the engine, then
//      custody again — derive their directory from the custody's segment, create nothing themselves,
//      and never call the ungoverned engine open;
//   S6 no production source reaches a custody fixture: `HostStoreCustody::fixture(` appears only in
//      test code or behind a fixture cfg.
//
// Comments are stripped before every scan; test modules, `tests` directories and cfg(test) /
// fixture-gated items are excluded from the production scans (brace-matched).
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const read = (p) => fs.readFileSync(p, "utf8").replace(/^﻿/, "");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

// Skip a string or char literal starting at i; return the index after it (or i if none).
function skipLiteral(src, i) {
  if (src[i] === '"') {
    i++;
    while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
    return i + 1;
  }
  if (src[i] === "'" && /^'(\\.|[^\\'])'/.test(src.slice(i, i + 4))) return i + (src[i + 1] === "\\" ? 4 : 3);
  return i;
}

// From `from`, return the index just past the item a cfg attribute governs: a brace-matched block
// when `{` comes first, otherwise through the first `,` or `;`.
function itemEnd(src, from) {
  let i = from;
  while (i < src.length) {
    const j = skipLiteral(src, i);
    if (j !== i) { i = j; continue; }
    const c = src[i];
    if (c === "," || c === ";") return i + 1;
    if (c === "{") {
      let depth = 1;
      i++;
      while (i < src.length && depth > 0) {
        const k = skipLiteral(src, i);
        if (k !== i) { i = k; continue; }
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
      }
      return i;
    }
    i++;
  }
  return src.length;
}

// Remove every item gated to tests or fixtures: `#[cfg(test)]`, `#[cfg(all(test, ...))]` and
// `#[cfg(any(test, feature = "test-fixtures"))]`, whatever it governs (module, fn, impl, statement,
// field, variant or match arm).
function stripTestItems(src) {
  const gate = /#\[cfg\((?:test|all\(test[^\]]*\)|any\(test,\s*feature\s*=\s*"test-fixtures"\))\)\]/g;
  let out = "";
  let from = 0;
  let m;
  while ((m = gate.exec(src)) !== null) {
    out += src.slice(from, m.index);
    const end = itemEnd(src, m.index + m[0].length);
    from = end;
    gate.lastIndex = end;
  }
  return out + src.slice(from);
}

const production = (p) => stripTestItems(stripComments(read(p)));

function productionSources() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "target" || e.name === "tests") continue;
        walk(full);
      } else if (e.name.endsWith(".rs") && e.name !== "tests.rs") out.push(full);
    }
  };
  for (const c of fs.readdirSync(HOST, { withFileTypes: true })) {
    const src = path.join(HOST, c.name, "src");
    if (c.isDirectory() && fs.existsSync(src)) walk(src);
  }
  return out;
}

// The body of `fn <name>` (brace-matched from its first `{`).
function fnBody(code, name) {
  const at = code.search(new RegExp("fn\\s+" + name + "\\s*[<(]"));
  if (at < 0) return null;
  const open = code.indexOf("{", at);
  if (open < 0) return null;
  return code.slice(open, itemEnd(code, open));
}

function run() {
  const errors = [];
  const E = (m) => errors.push(m);
  const must = (file) => {
    if (!fs.existsSync(file)) {
      E("missing: " + rel(file));
      return "";
    }
    return production(file);
  };

  // ---- S1: the committed policy, composed once in the frozen plan ----
  {
    const plan = must(path.join(HOST, "windows-host-activation-plan", "src", "acl_plan.rs"));
    const body = fnBody(plan, "compose_host_store_with_resolved_principal");
    if (!body) E("S1 the frozen plan has no host-store composition");
    else {
      if (!/principal:\s*service\.principal\(\)\.clone\(\),\s*rights:\s*RightsClass::Modify/.test(body))
        E("S1 the service principal is not granted exactly Modify");
      if (/principal:\s*service\.principal\(\)\.clone\(\),\s*rights:\s*RightsClass::FullControl/.test(body))
        E("S1 the service principal is granted FullControl over its own state");
      if (!/principal:\s*AclPrincipal::OwnerRights,\s*rights:\s*RightsClass::ReadAttributes/.test(body))
        E("S1 OWNER RIGHTS does not neutralise the owner's implicit WRITE_DAC with a read-only grant");
      if (!/AclPolicy::strict\(service\.principal\(\)\.clone\(\),\s*allowed\)/.test(body))
        E("S1 the store policy is not the closed strict policy owned by the service principal");
      if (/allow_inherited_aces\s*=\s*true|require_protected_dacl\s*=\s*false|allow_unknown_principals\s*=\s*true/.test(body))
        E("S1 the store policy relaxes the strict policy");
    }
    const principal = must(path.join(HOST, "windows-acl-policy", "src", "principal.rs"));
    if (!/Self::OwnerRights\s*=>\s*Ok\(OwnedSid::owner_rights\(\)\)/.test(principal))
      E("S1 OWNER RIGHTS does not resolve to its well-known SID");
    if (!/fn owner_rights\(\)\s*->\s*Self\s*\{\s*Self::well_known\(3,\s*&\[4\]\)/.test(principal))
      E("S1 OWNER RIGHTS is not S-1-3-4");
  }

  // ---- S2: privilege-free, create-only governed creation ----
  {
    const lib = must(path.join(HOST, "windows-acl-policy", "src", "lib.rs"));
    const creatable = fnBody(lib, "creatable_state") || "";
    if (!/windows::refuse_impersonation\(\)\?/.test(creatable))
      E("S2 governed creation does not refuse an impersonating thread");
    if (!/if owner != windows::current_account_sid\(\)\? \{\s*return Err\(AclPolicyError::PolicyRefused\);/.test(creatable))
      E("S2 governed creation does not refuse an owner other than the calling account");
    for (const f of ["create_directory_governed", "create_file_governed"]) {
      const b = fnBody(lib, f);
      if (!b) { E("S2 missing " + f); continue; }
      if (!/Self::creatable_state\(policy\)\?/.test(b)) E("S2 " + f + " skips the pre-effect owner rule");
      if (!/verify::verify\(&observed, policy\)\?\.is_conforming\(\)/.test(b))
        E("S2 " + f + " does not judge the created object by an authoritative re-read");
      if (/apply_|privilege/i.test(b)) E("S2 " + f + " reaches an apply call or a privilege");
    }
    const win = must(path.join(HOST, "windows-acl-policy", "src", "windows.rs"));
    const cf = fnBody(win, "create_file_with_security") || "";
    if (!/CREATE_NEW,/.test(cf)) E("S2 a governed file is not created CREATE_NEW");
    if (/OPEN_ALWAYS|CREATE_ALWAYS|TRUNCATE_EXISTING/.test(cf)) E("S2 a governed file creation can open an existing file");
    const cd = fnBody(win, "create_directory_with_security") || "";
    if (!/CreateDirectoryW\(/.test(cd)) E("S2 the governed directory is not created by CreateDirectoryW");
    const desc = fnBody(win, "new") || "";
    if (!/SetSecurityDescriptorControl\(psd, SE_DACL_PROTECTED, SE_DACL_PROTECTED\)/.test(win))
      E("S2 the creation descriptor's DACL is not protected");
    if (!/SetSecurityDescriptorOwner\(psd, owner_ptr, 0\)/.test(win))
      E("S2 the creation descriptor does not state its owner");
    for (const [name, b] of [["create_file_with_security", cf], ["create_directory_with_security", cd]])
      if (/run_in_restore_privilege_window|ProcessRestorePrivilege|AdjustTokenPrivileges|SetSecurityInfo/.test(b))
        E("S2 " + name + " reaches a privilege or a re-securing call");
    void desc;
  }

  // ---- S3: trusted-roots custody ----
  {
    const sc = must(path.join(HOST, "trusted-roots", "src", "activation", "store_custody.rs"));
    if (/AclPolicy::strict\(|AclPolicy\s*\{/.test(sc)) E("S3 the custody states a policy of its own");
    if (!/compose_host_store_with_resolved_principal\(/.test(sc)) E("S3 the custody does not compose through the frozen plan");
    if (!/resolve_account_sid\(&format!\("NT SERVICE\\\\\{EXPECTED_SERVICE_NAME\}"\)\)/.test(sc))
      E("S3 the production principal is not resolved through Windows from the frozen service name");
    if (!/ApprovedServicePrincipal::from_resolved_sid\(STRATEGY, sid\)/.test(sc))
      E("S3 the custody binds a guessed principal instead of a resolved SID");
    if (/apply_directory_policy\(|apply_file_policy\(|apply_and_verify(_file)?\(/.test(sc))
      E("S3 the custody can re-secure an existing object");
    const est = fnBody(sc, "establish");
    if (!est) E("S3 the custody has no establish");
    else {
      const iPolicy = est.indexOf("self.policy()?");
      const iCreate = est.indexOf("create_directory_governed(");
      const iVerify = est.indexOf("governed.verify_contents()?");
      if (iPolicy < 0 || iCreate < 0 || iVerify < 0 || !(iPolicy < iCreate && iCreate < iVerify))
        E("S3 establish does not compose, then create, then judge — in that order");
    }
    const custody = fnBody(sc, "store_custody") || "";
    if (!/principal:\s*CustodyPrincipal::InstalledService/.test(custody))
      E("S3 the production store custody is not the installed service");
    if (/CallingAccount|fixture/.test(custody)) E("S3 production store custody reaches a fixture principal");
  }

  // ---- S4: the durable engine's creation sites ----
  {
    const store = must(path.join(HOST, "windows-durable-protected-store", "src", "store.rs"));
    const aw = must(path.join(HOST, "windows-durable-protected-store", "src", "atomic_write.rs"));
    for (const [name, code] of [["store.rs", store], ["atomic_write.rs", aw]])
      if (/create_dir_all\(|OpenOptions|File::create\(/.test(code))
        E("S4 " + name + " creates an object without the creation hook");
    if (!/pub fn open_governed\(\s*root: &str,\s*creation: Box<dyn ObjectCreation>,?\s*\)/.test(store))
      E("S4 the engine has no governed open");
    if (!/creation\.directory\(&dir\)\?/.test(fnBody(store, "ensure_layout") || "")) E("S4 the layout bypasses the hook");
    if (!/creation\.lock_file\(/.test(fnBody(store, "acquire_lock") || "")) E("S4 the lock bypasses the hook");
    if (!/creation\.staging_file\(temp_path\)\?/.test(fnBody(aw, "write_staged") || "")) E("S4 staging bypasses the hook");
    const cr = must(path.join(HOST, "windows-durable-protected-store", "src", "creation.rs"));
    for (const m of ["creator.create_directory(path)", "creator.create_file(path)"])
      if (!cr.includes(m)) E("S4 the governed creation route does not reach " + m);
  }

  // ---- S5: both stores open through the shared governed open ----
  {
    const ipc = path.join(HOST, "windows-local-ipc", "src");
    const shared = must(path.join(ipc, "store_custody.rs"));
    const open = fnBody(shared, "open_governed_store") || "";
    const a = open.indexOf("custody.establish(store)");
    const b = open.indexOf("DurableProtectedStore::open_governed(");
    const c = open.indexOf("governed.verify_contents()");
    if (a < 0 || b < 0 || c < 0 || !(a < b && b < c))
      E("S5 the governed open is not custody, then the engine, then custody again");
    for (const [file, store, constName] of [
      [path.join(ipc, "owner_programme_delegation", "durable_store.rs"), "DelegationLifecycle", "DELEGATION_STATE_RELATIVE_ROOT"],
      [path.join(ipc, "operation_contract", "request_replay", "durable_store.rs"), "RequestReplay", "REQUEST_REPLAY_RELATIVE_ROOT"],
    ]) {
      const code = must(file);
      if (!new RegExp("open_governed_store\\(&root\\.custody, HostStateStore::" + store + "\\)").test(code))
        E("S5 " + rel(file) + " does not open through the governed open");
      if (/DurableProtectedStore::open\(|std::fs::create_dir|create_dir_all\(/.test(code))
        E("S5 " + rel(file) + " opens the engine ungoverned or creates a directory itself");
      if (!new RegExp("pub const " + constName + ": &str = HostStateStore::" + store + "\\.segment\\(\\);").test(code))
        E("S5 " + rel(file) + " spells its directory instead of taking the custody's segment");
      if (!/custody:\s*activated\.store_custody\(\)/.test(code))
        E("S5 " + rel(file) + " takes its custody from somewhere other than the activated root");
    }
  }

  // ---- S6: no custody fixture from production code ----
  for (const f of productionSources()) {
    if (production(f).includes("HostStoreCustody::fixture(")) E("S6 " + rel(f) + " reaches a custody fixture from production code");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-host-store-custody-10i] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-host-store-custody-10i: PASS");
}
