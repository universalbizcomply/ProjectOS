// Validator: CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A (contract + reader checkpoint)
//
// Fails closed. Proves the completed half of the functional pilot:
//  - exactly ONE new message kind, and every pre-existing kind and payload length is unchanged;
//  - InstalledHostStatus is a fixed 21-byte closed record: 5 closed enum bytes + two hex prefixes;
//  - no generic payload accessor exists anywhere in the protocol;
//  - the live IPC capability has exactly one production route, gated on a non-default feature and
//    consuming an exact-phrase owner approval, scoped read-only;
//  - the identity record deserialises strictly (deny_unknown_fields);
//  - the service-side observer can never report Verified/Ready without the frozen reader saying so,
//    and always reports protected operations as Refused.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const IPC = path.join(HOST, "windows-local-ipc");
const SH = path.join(HOST, "service-host");
const HI = path.join(HOST, "host-identity");
const px = (d) => d.replace(/\\/g, "/");

const read = (f) => fs.readFileSync(f, "utf8");
const stripLine = (s) => s.replace(/\/\/.*/g, "");
const stripToml = (s) => s.replace(/#.*/g, "");
const stripTests = (s) => {
  const i = s.search(/#\[cfg\(test\)\]\s*\nmod \w*tests/);
  return i === -1 ? s : s.slice(0, i);
};

function workdir() {
  if (!__SCRATCH_DIR) __SCRATCH_DIR = scratch.owned("cd-b4-installed-host-status-contract1a");
  return __SCRATCH_DIR;
}

const DEPS = {
  ipc: `projectos-host-windows-local-ipc = { path = "${px(IPC)}" }`,
  "ipc-owner": `projectos-host-windows-local-ipc = { path = "${px(
    IPC
  )}", features = ["owner-approved-status-read"] }`,
};

function compileConsumer(name, body, dep) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "Cargo.toml"),
    [
      "[workspace]",
      "",
      "[package]",
      `name = "${name.replace(/[^a-z0-9_]/g, "_")}"`,
      'version = "0.0.0"',
      'edition = "2021"',
      "publish = false",
      "",
      "[dependencies]",
      DEPS[dep],
      "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(dir, "src", "main.rs"), body);
  const r = spawnSync("cargo", ["build", "--offline", "--quiet"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: path.join(workdir(), "target") },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

const CONTROL = [
  "status_decoder_control",
  "ipc",
  `use projectos_host_windows_local_ipc::{decode_installed_host_status, FrameParseError};
fn main(){
    // A short buffer is refused rather than accepted; the decoder is reachable in the DEFAULT graph.
    assert!(matches!(decode_installed_host_status(&[0u8; 4]), Err(FrameParseError::TruncatedHeader)));
}`,
];

const NEGATIVES = [
  {
    name: "neg_capability_without_owner_approval",
    dep: "ipc-owner",
    why: "the capability's sealing field is reachable, so it could be forged without an owner approval",
    // A FIELD-ACCESS probe, not a struct literal: a literal fails on a type mismatch, which would
    // still "pass" if the field were public. Naming the field proves the seal itself.
    body: `use projectos_host_windows_local_ipc::LiveIpcOperationCapability;\nfn f(c: &LiveIpcOperationCapability) { let _ = &c._sealed; }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_capability_factory",
    dep: "ipc-owner",
    why: "the capability has a factory that does not consume an owner approval",
    body: `use projectos_host_windows_local_ipc::LiveIpcOperationCapability;\nfn main(){ let _ = LiveIpcOperationCapability::new(); }`,
  },
  {
    name: "neg_capability_in_default_graph",
    dep: "ipc",
    why: "the owner-approval capability route is reachable in the DEFAULT graph",
    body: `fn main(){ let _ = projectos_host_windows_local_ipc::OwnerStatusReadApproval::transcribe("x"); }`,
  },
  {
    name: "neg_status_record_forged",
    dep: "ipc",
    why: "the status record is constructible by struct literal, bypassing prefix validation",
    body: `use projectos_host_windows_local_ipc::InstalledHostStatus;\nfn f() -> InstalledHostStatus { InstalledHostStatus { service_state: unimplemented!() } }\nfn main(){ let _ = f; }`,
  },
  {
    name: "neg_approval_defaulted",
    dep: "ipc-owner",
    why: "the owner approval is obtainable via Default",
    body: `fn main(){ let _: projectos_host_windows_local_ipc::OwnerStatusReadApproval = Default::default(); }`,
  },
];

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const protoP = path.join(IPC, "src", "protocol.rs");
  const adapterP = path.join(IPC, "src", "adapter.rs");
  const statusP = path.join(SH, "src", "status.rs");
  const recordP = path.join(HI, "src", "identity", "canonical_record.rs");
  for (const f of [protoP, adapterP, statusP, recordP])
    if (!fs.existsSync(f)) E("V1 missing mandatory path: " + f);
  if (errors.length) return errors;

  const protoRaw = read(protoP);
  const proto = stripLine(stripTests(protoRaw));
  const adapter = stripLine(stripTests(read(adapterP)));
  const status = stripLine(stripTests(read(statusP)));
  const record = stripLine(read(recordP));
  const ipcToml = stripToml(read(path.join(IPC, "Cargo.toml")));

  // ---- V2 exactly one new kind; every pre-existing kind and length unchanged ----
  {
    const m = /fn required_payload_len\(kind: MessageKind\) -> usize \{([\s\S]*?)\n\}/.exec(proto);
    if (!m) E("V2 the payload-length table is missing");
    else {
      const t = m[1];
      for (const [kind, len] of [
        ["ControllerHello", 1],
        ["ServiceReady", 1],
        ["ShutdownRequest", 1],
        ["ShutdownAcknowledged", 1],
        ["ServiceEvidence", 4],
        ["AuthorityOutcome", 1],
        ["TypedRefusal", 1],
      ]) {
        // Each pre-existing kind must still resolve to its original length. The four 1-byte control
        // kinds share an arm, so the check is that the kind appears and no other length is bound to it.
        if (!t.includes(kind)) E(`V2 pre-existing kind ${kind} vanished from the length table`);
        const own = new RegExp(`MessageKind::${kind}\\s*=>\\s*(\\d+)`);
        const hit = own.exec(t);
        if (hit && Number(hit[1]) !== len)
          E(`V2 pre-existing payload length changed: ${kind} => ${hit[1]} (was ${len})`);
      }
      if (!/MessageKind::InstalledHostStatus => INSTALLED_HOST_STATUS_LEN/.test(t))
        E("V2 the status kind is not bound to its own fixed length");
    }
    if (!/InstalledHostStatus => 8,/.test(proto)) E("V2 the status kind is not discriminant 8");
    for (const [k, d] of [
      ["ControllerHello", 1],
      ["ServiceReady", 2],
      ["ServiceEvidence", 3],
      ["AuthorityOutcome", 4],
      ["ShutdownRequest", 5],
      ["ShutdownAcknowledged", 6],
      ["TypedRefusal", 7],
    ])
      if (!new RegExp(`Self::${k} => ${d},`).test(proto))
        E(`V2 pre-existing discriminant changed: ${k} should be ${d}`);
  }

  // ---- V3 the record is fixed-width and closed ----
  if (!/pub const INSTALLED_HOST_STATUS_LEN: usize = 5 \+ STATUS_PREFIX_LEN \+ STATUS_PREFIX_LEN;/.test(proto))
    E("V3 the status length is not 5 closed enum bytes plus two prefixes");
  if (!/pub const STATUS_PREFIX_LEN: usize = 8;/.test(proto)) E("V3 the prefix length is not 8");
  {
    const m = /pub struct InstalledHostStatus \{([\s\S]*?)\n\}/.exec(proto);
    if (!m) E("V3 the status record is missing");
    else if (/\bpub\s+\w+\s*:/.test(m[1])) E("V3 the status record has a public field");
  }
  for (const needle of [
    "ServiceStateReport",
    "IdentityVerificationReport",
    "ChannelReport",
    "ReadinessReport",
    "ProtectedOperationsReport",
  ])
    if (!proto.includes(needle)) E("V3 the record is missing the closed enum " + needle);
  if (!/fn is_lower_hex_prefix/.test(proto)) E("V3 prefixes are not validated as lower-case hex");
  // Nothing free-form or identifying may be representable.
  for (const bad of ["installation_id", "String,", "Vec<u8>", "HashMap", "serde_json"])
    if (proto.includes(bad)) E("V3 the protocol gained a free-form or identifying field: " + bad);

  // ---- V4 no generic payload accessor ----
  for (const re of [
    /pub fn payload\s*\(/,
    /pub fn payload_bytes\s*\(/,
    /pub fn body\s*\(/,
    /pub fn as_bytes\s*\(/,
    /->\s*&\[u8\]/,
  ])
    if (re.test(proto)) E("V4 a generic payload accessor is exposed: " + re);
  // The strict decoder must exist and must check the kind.
  if (!/pub fn decode_installed_host_status/.test(proto)) E("V4 the strict decoder is missing");
  {
    const m = /pub fn decode_installed_host_status\(([\s\S]*?)\n\}/.exec(proto);
    if (m) {
      if (!/UnexpectedMessageKind/.test(m[1])) E("V4 the decoder does not refuse a wrong kind");
      if (!/UnknownStatusEnum/.test(m[1])) E("V4 the decoder does not refuse an unknown enum byte");
      if (!/parse_single_frame\(buf\)\?/.test(m[1]))
        E("V4 the decoder does not go through the strict frame parser");
    }
  }

  // ---- V5 the capability has exactly one gated, approval-consuming route ----
  {
    const impls = [
      ...adapter.matchAll(
        /#\[cfg\(feature = "([^"]+)"\)\]\s*impl LiveIpcOperationCapability \{([\s\S]*?)\n\}/g
      ),
    ];
    const gates = impls.map((m) => m[1]).sort();
    if (JSON.stringify(gates) !== JSON.stringify(["owner-approved-status-read", "test-fixtures"]))
      E("V5 unexpected capability acquisition routes: " + JSON.stringify(gates));
    const owner = impls.find((m) => m[1] === "owner-approved-status-read");
    if (!owner) E("V5 the owner-approval acquisition is missing");
    else if (!/from_owner_status_read_approval\(approval: OwnerStatusReadApproval\)/.test(owner[2]))
      E("V5 the owner acquisition does not consume an owner approval");
    if (!/phrase != Self::REQUIRED_PHRASE/.test(adapter))
      E("V5 the approval is not gated on the exact required phrase");
    // The seal itself must stay private on BOTH types. A compile control alone is not enough here:
    // publishing the field makes the crate fail to build (private type in public interface), which a
    // negative control would read as "still refused". The structural check catches it directly.
    for (const t of ["LiveIpcOperationCapability", "OwnerStatusReadApproval"]) {
      const m = new RegExp(`pub struct ${t} \\{([\\s\\S]*?)\\n\\}`).exec(adapter);
      if (!m) E(`V5 ${t} is missing`);
      else if (/\bpub\s+\w+\s*:/.test(m[1])) E(`V5 ${t} has a public field — the seal is broken`);
    }
    if (/impl Default for OwnerStatusReadApproval/.test(adapter)) E("V5 the approval is defaultable");
    if (!/ReadInstalledHostStatusLocalOnly/.test(adapter)) E("V5 the read-only scope is missing");
    {
      const m = /pub enum CapabilityScope \{([\s\S]*?)\n\}/.exec(adapter);
      if (!m) E("V5 the capability scope enum is missing");
      else {
        const variants = (m[1].match(/^\s{4}\w+,/gm) || []).length;
        if (variants !== 1) E(`V5 the capability scope has ${variants} variants; exactly 1 is allowed`);
      }
    }
  }
  {
    const feats = (/\n\[features\]([\s\S]*?)(\n\[|$)/.exec(ipcToml) || [])[1] || "";
    if (!/owner-approved-status-read\s*=\s*\[\s*\]/.test(feats))
      E("V5 the owner feature is missing or pulls a dependency");
    if (/default\s*=\s*\[[^\]]*owner-approved-status-read/.test(feats))
      E("V5 the owner capability is enabled by default");
  }

  // ---- V6 the identity record deserialises strictly ----
  if (!/#\[serde\(deny_unknown_fields\)\]\s*\npub struct InstallationIdentityRecordV1/.test(record))
    E("V6 the identity record does not deny unknown fields");
  if (!/serde::Deserialize/.test(record)) E("V6 the identity record is not deserialisable");
  if (/derive\([^)]*Serialize/.test(record)) E("V6 the read boundary gained a SERIALISER");

  // ---- V7 the observer cannot claim what the reader did not say ----
  {
    if (!/verify_record\(&record, RecordInstallationEvidence::Matched\)/.test(status))
      E("V7 the observer does not use the frozen reader contract");
    // Verified may appear ONLY as the Ok arm of verify_record, and Ready only under Verified.
    const verifiedSites = (status.match(/IdentityVerificationReport::Verified/g) || []).length;
    if (!/Ok\(_verified\) => \(IdentityVerificationReport::Verified/.test(status))
      E("V7 Verified is not produced solely by a successful verify_record");
    if (verifiedSites > 2)
      E(`V7 Verified appears at ${verifiedSites} sites; it must not be assignable elsewhere`);
    const m = /let readiness = match identity \{([\s\S]*?)\n    \};/.exec(status);
    if (!m) E("V7 readiness is not derived from the identity result");
    else if (!/Refused \| IdentityVerificationReport::Unavailable => \{\s*ReadinessReport::NotReady/.test(m[1]))
      E("V7 a non-verified identity does not force NotReady");
    // Protected operations are frozen Refused.
    if (/ProtectedOperationsReport::Authorised/.test(status))
      E("V7 the observer can report protected operations as Authorised");
    if ((status.match(/ProtectedOperationsReport::Refused/g) || []).length < 2)
      E("V7 protected operations are not consistently refused");
    // Read-only: the observer writes nothing.
    for (const bad of ["fs::write", "create_dir", "File::create", "remove_file", "OpenOptions"])
      if (status.includes(bad)) E("V7 the status observer mutates the filesystem: " + bad);
  }

  // ---- compile proofs ----
  {
    const r = compileConsumer(CONTROL[0], CONTROL[2], CONTROL[1]);
    if (!r.ok) E("CONTROL failed to compile (setup broken):\n" + r.out.slice(0, 1000));
  }
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.dep);
    if (r.ok) E("STATUS CONTRACT LEAK — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-installed-host-status-contract1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-installed-host-status-contract1a: PASS");
}
