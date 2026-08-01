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
const CC = path.join(ROOT, "projectos", "control-center");
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

  // ---- V8 the transport is SPECIFIC: no generic send, no raw payload out ----
  {
    const ffiP = path.join(IPC, "src", "windows_ffi.rs");
    if (!fs.existsSync(ffiP)) E("V8 the live backend is missing");
    else {
      const ffi = stripLine(stripTests(read(ffiP)));

      // The trait carries exactly the two SPECIFIC status operations, and no byte-level send/receive.
      const t = /pub trait IpcBackend \{([\s\S]*?)\n\}/.exec(adapter);
      if (!t) E("V8 the backend trait is missing");
      else {
        for (const m of [
          "fn send_installed_host_status(&self, status: &InstalledHostStatus) -> SendOutcome;",
          "fn receive_installed_host_status(&self) -> StatusReceipt;",
        ])
          if (!t[1].includes(m)) E("V8 the backend trait is missing " + m);
        for (const re of [/fn send_bytes/, /fn send_payload/, /fn send_frame\s*\(/, /&\[u8\]\s*\)\s*->\s*SendOutcome/])
          if (re.test(t[1])) E("V8 the backend trait exposes a generic byte send: " + re);
      }

      // No PUBLIC API in the transport hands back raw bytes.
      for (const [label, src] of [["adapter.rs", adapter], ["windows_ffi.rs", ffi]])
        for (const re of [/pub fn [\w]*payload[\w]*\s*\(/, /pub fn \w+\([^)]*\)\s*->\s*&\[u8\]/, /pub fn \w+\([^)]*\)\s*->\s*Vec<u8>/])
          if (re.test(src)) E(`V8 ${label} returns raw payload bytes: ${re}`);

      // StatusReceipt carries the DECODED record, never bytes.
      const sr = /pub enum StatusReceipt \{([\s\S]*?)\n\}/.exec(adapter);
      if (!sr) E("V8 StatusReceipt is missing");
      else {
        if (!/Ok\(InstalledHostStatus\)/.test(sr[1])) E("V8 StatusReceipt does not carry the decoded record");
        if (/\[u8\]|Vec<u8>/.test(sr[1])) E("V8 StatusReceipt carries raw bytes");
      }

      // Both adapter status methods stay capability-gated.
      for (const m of ["send_installed_host_status", "receive_installed_host_status"]) {
        const re = new RegExp(`pub fn ${m}\\(\\s*&self,\\s*_cap: &LiveIpcOperationCapability`);
        if (!re.test(adapter)) E(`V8 adapter::${m} is not capability-gated`);
      }

      // The live send uses the CANONICAL encoder; the live receive uses the STRICT decoder and maps a
      // decode failure to Malformed — never to a fabricated success.
      const send = /fn send_installed_host_status\(&self, status: &InstalledHostStatus\) -> SendOutcome \{([\s\S]*?)\n    \}/.exec(ffi);
      if (!send) E("V8 the live status send is missing");
      else if (!/write_frame\(&encode_installed_host_status\(&self\.nonce, status\)\)/.test(send[1]))
        E("V8 the live status send bypasses the canonical encoder");
      const recv = /fn receive_installed_host_status\(&self\) -> StatusReceipt \{([\s\S]*?)\n    \}/.exec(ffi);
      if (!recv) E("V8 the live status receive is missing");
      else {
        if (!/decode_installed_host_status\(&buf\[\.\.n\]\)/.test(recv[1]))
          E("V8 the live status receive bypasses the strict decoder");
        if (!/Err\(e\) => StatusReceipt::Malformed\(e\)/.test(recv[1]))
          E("V8 a malformed status frame is not reported as Malformed");
        if (/StatusReceipt::Ok\(InstalledHostStatus::new/.test(recv[1]))
          E("V8 the receive path fabricates a status record");
      }

      // Every control-frame caller encodes first; the private writer takes bytes.
      if (!/fn write_frame\(&self, frame: &\[u8\]\)/.test(ffi))
        E("V8 the private writer no longer takes encoded bytes");
      for (const m of ["fn send_control", "fn send_handshake"]) {
        const b = new RegExp(`${m}\\(([\\s\\S]*?)\\n    \\}`).exec(ffi);
        if (b && !/encode_control_frame\(/.test(b[1]))
          E(`V8 ${m} sends unencoded data instead of a canonical control frame`);
      }
    }
  }

  // ---- V9 the WORKFLOW: serve loop, client route and Control Centre display ----
  //
  // Catches the six final integration mutations: a service that sends the full installation ID, a
  // service that accepts a wrong request kind, protected operations reported Authorised, identity
  // verification hardcoded Verified, and a Control Centre that displays Unverified as Verified or
  // Refused as Authorised.
  {
    const ffiP = path.join(IPC, "src", "windows_ffi.rs");
    const protoP = path.join(IPC, "src", "protocol.rs");
    const serveP = path.join(SH, "src", "serve.rs");
    const statusP = path.join(SH, "src", "status.rs");
    const scmP = path.join(SH, "src", "scm.rs");
    const ccRsP = path.join(CC, "src-tauri", "src", "host_status.rs");
    const ccTsP = path.join(CC, "src", "daemon", "installedHostStatus.ts");
    const panelP = path.join(CC, "src", "daemon", "LiveMissionControl.tsx");

    const missing = [serveP, ccRsP, ccTsP, panelP].filter((f) => !fs.existsSync(f));
    for (const f of missing) E("V9 missing workflow file: " + px(f));

    if (missing.length === 0) {
      const ffi = stripLine(stripTests(read(ffiP)));
      const proto = read(protoP);
      const serve = stripLine(read(serveP));
      const status = stripLine(stripTests(read(statusP)));
      const scm = stripLine(stripTests(read(scmP)));
      const ccRs = stripLine(stripTests(read(ccRsP)));
      const ccTs = stripLine(read(ccTsP));
      const panel = stripLine(read(panelP));

      // --- ONE frozen run id: the same constant gives both ends the pipe name AND the nonce. ---
      if (!/pub const INSTALLED_HOST_STATUS_RUN_ID: \[u8; 8\] = \[/.test(proto))
        E("V9 the frozen status run identifier is missing");
      if (!/backend: WindowsPipeBackend::new\(crate::protocol::INSTALLED_HOST_STATUS_RUN_ID\)/.test(ffi))
        E("V9 the client is not bound to the frozen run identifier");
      if (!/LocalIpcAdapter::new\(WindowsPipeBackend::new\(\s*crate::protocol::INSTALLED_HOST_STATUS_RUN_ID,\s*\)\)/.test(ffi))
        E("V9 the server is not bound to the frozen run identifier");

      // --- The serve loop performs EXACTLY the four accepted steps, in order. ---
      const serveFn = /fn serve_one_status_exchange\(([\s\S]*?)\n    \}\n\}/.exec(ffi);
      if (!serveFn) E("V9 the served status exchange is missing");
      else {
        const b = serveFn[1];
        const order = [
          "prepare_server(",
          "accept_unauthenticated(",
          "complete_service_handshake(",
          "send_installed_host_status(",
        ];
        let at = -1;
        for (const step of order) {
          const i = b.indexOf(step);
          if (i === -1) {
            E("V9 the serve loop is missing step: " + step);
            break;
          }
          if (i < at) {
            E("V9 the serve loop performs its steps out of order at: " + step);
            break;
          }
          at = i;
        }
        // MUTATION 2 — a service that accepts a wrong request kind. Only a CONFIRMED peer is served.
        if (!/if !handshake\.is_peer_confirmed\(\) \{[\s\S]{0,160}return ServeStatusOutcome::RefusedHandshake\(handshake\)/.test(b))
          E("V9 the serve loop answers a request whose handshake was not confirmed");
        // The host is observed only AFTER the request is confirmed.
        const iHs = b.indexOf("is_peer_confirmed");
        const iObs = b.indexOf("observe()");
        if (iHs === -1 || iObs === -1 || iObs < iHs)
          E("V9 the serve loop observes the host before confirming the request");
        for (const banned of ["CreateServiceW", "ChangeServiceConfig", "SetSecurityInfo", "fs::write"]) {
          if (b.includes(banned)) E("V9 the served exchange performs a protected operation: " + banned);
        }
      }
      for (const banned of ["CreateServiceW", "ChangeServiceConfig", "SetSecurityInfo", "fs::write", "OpenSCManager"]) {
        if (serve.includes(banned)) E("V9 the serve module performs a protected operation: " + banned);
      }

      // --- The service's capability comes from the exact frozen phrase and nothing else. ---
      if (!/OwnerStatusReadApproval::transcribe\(OwnerStatusReadApproval::REQUIRED_PHRASE\)/.test(serve))
        E("V9 the service does not mint its capability from the frozen owner phrase");
      if (!/else \{[\s\S]{0,200}return;/.test(serve))
        E("V9 the service does not fail closed when the phrase is refused");
      if (!/status::observe\(ServiceStateReport::Running\)/.test(serve))
        E("V9 the serve loop does not report the state it is actually serving in");
      if (!/serve::serve_installed_host_status_until_stop\(&STOP_SIGNALLED\)/.test(scm))
        E("V9 the SCM entry does not start the status serve loop");
      if (!/run_inert_loop\(&mut lifecycle, &STOP_SIGNALLED\)/.test(scm))
        E("V9 the proven stop path was replaced rather than kept");

      // --- MUTATION 1 — the full installation ID must never reach the wire or the screen. ---
      if (/installation_id/.test(status))
        E("V9 the observer reads the installation id, which must never be sent");
      if (/installation_id|InstallationId/.test(ffi))
        E("V9 the transport references an installation id");
      if (/installation_id|installationId/.test(ccRs))
        E("V9 the Control Centre route references an installation id");
      if (/installationId/.test(ccTs) || /installationId/.test(panel))
        E("V9 the Control Centre display references an installation id");
      if (!/pub const STATUS_PREFIX_LEN: usize = 8;/.test(proto))
        E("V9 the status prefix length is no longer fixed at 8");

      // --- MUTATION 3 — protected operations are always Refused on the service side. ---
      const observe = /pub fn observe\(service_state: ServiceStateReport\) -> InstalledHostStatus \{([\s\S]*?)\n\}/.exec(status);
      if (!observe) E("V9 the observer is missing");
      else {
        if (/ProtectedOperationsReport::Authorised/.test(observe[1]))
          E("V9 the observer reports protected operations as Authorised");
        if (!/ProtectedOperationsReport::Refused/.test(observe[1]))
          E("V9 the observer no longer reports protected operations as Refused");
        if (!/IdentityVerificationReport::Verified => \{[\s\S]{0,240}ReadinessReport::Ready/.test(observe[1]))
          E("V9 readiness is not gated on a Verified identity");
      }

      // --- MUTATION 4 — identity verification comes ONLY from verify_record. ---
      const rav = /fn read_and_verify\(\)[\s\S]*?\n\}/.exec(status);
      if (!rav) E("V9 the identity read is missing");
      else {
        const b = rav[0];
        if (!/match verify_record\(&record, RecordInstallationEvidence::Matched\)/.test(b))
          E("V9 identity verification no longer goes through verify_record");
        const verified = (b.match(/IdentityVerificationReport::Verified/g) || []).length;
        if (verified !== 1)
          E("V9 identity Verified is reported from " + verified + " places, not solely the reader's Ok arm");
        if (!/Ok\(_verified\) => \(IdentityVerificationReport::Verified/.test(b))
          E("V9 identity Verified is not bound to the reader accepting");
        if (!/Err\(_\) => \(IdentityVerificationReport::Refused/.test(b))
          E("V9 a record the reader refused is not reported as Refused");
      }

      // --- MUTATIONS 5 and 6 — the Control Centre never upgrades what the host said. ---
      const idLabel = /fn identity_label\(v: IdentityVerificationReport\) -> &'static str \{([\s\S]*?)\n\}/.exec(ccRs);
      if (!idLabel) E("V9 the Control Centre identity label is missing");
      else {
        if (!/IdentityVerificationReport::Verified => "VERIFIED"/.test(idLabel[1]))
          E("V9 the Control Centre does not render Verified as VERIFIED");
        if (!/IdentityVerificationReport::Refused => "REFUSED"/.test(idLabel[1]))
          E("V9 the Control Centre displays a REFUSED identity as something else");
        if (!/IdentityVerificationReport::Unavailable => UNAVAILABLE/.test(idLabel[1]))
          E("V9 the Control Centre displays an UNAVAILABLE identity as something else");
        if ((idLabel[1].match(/"VERIFIED"/g) || []).length !== 1)
          E("V9 the Control Centre renders VERIFIED from more than one identity report");
      }
      const rdLabel = /fn readiness_label\(v: ReadinessReport\) -> &'static str \{([\s\S]*?)\n\}/.exec(ccRs);
      if (!rdLabel) E("V9 the Control Centre readiness label is missing");
      else if ((rdLabel[1].match(/"READY"/g) || []).length !== 1 || !/ReadinessReport::Ready => "READY"/.test(rdLabel[1]))
        E("V9 the Control Centre renders READY for a readiness the host did not report");
      const pLabel = /fn protected_label\(v: ProtectedOperationsReport\) -> &'static str \{([\s\S]*?)\n\}/.exec(ccRs);
      if (!pLabel) E("V9 the Control Centre protected-operations label is missing");
      else {
        if (!/ProtectedOperationsReport::Refused => "REFUSED"/.test(pLabel[1]))
          E("V9 the Control Centre displays a REFUSED protected operation as something else");
        if ((pLabel[1].match(/"AUTHORISED"/g) || []).length > 1)
          E("V9 the Control Centre renders AUTHORISED for more than one protected-operations report");
      }

      // Every refusal path collapses to the unavailable view — never a fabricated success.
      const readFn = /pub fn read_installed_host_status\(\) -> InstalledHostStatusView \{([\s\S]*?)\n\}/.exec(ccRs);
      if (!readFn) E("V9 the Control Centre read route is missing");
      else {
        for (const arm of ["RefusedHandshake", "Malformed", "Failed"]) {
          const re = new RegExp("ClientStatusReadOutcome::" + arm + "\\(_\\) => InstalledHostStatusView::unavailable\\(");
          if (!re.test(readFn[1])) E("V9 a " + arm + " outcome is not shown as unavailable");
        }
        if (!/ClientStatusReadOutcome::Status\(status\) => project\(&status\)/.test(readFn[1]))
          E("V9 the Control Centre does not render the decoded record verbatim");
      }
      const unavail = /fn unavailable\(next_safe_action: &str\) -> Self \{([\s\S]*?)\n    \}/.exec(ccRs);
      if (!unavail) E("V9 the unavailable view is missing");
      else {
        if (/"VERIFIED"|"READY"|"AUTHORISED"/.test(unavail[1]))
          E("V9 the unavailable view reports a verified, ready or authorised value");
        if (!/read_succeeded: false/.test(unavail[1]))
          E("V9 the unavailable view claims the read succeeded");
      }

      // The front end never invents a value either.
      if (!/readSucceeded: o\.readSucceeded === true/.test(ccTs))
        E("V9 the front end accepts a non-true readSucceeded as success");
      if (/VERIFIED|READY|AUTHORISED/.test(ccTs))
        E("V9 the front end names a verified, ready or authorised value it could substitute");
      if (/VERIFIED|AUTHORISED/.test(panel))
        E("V9 the panel names a verified or authorised value it could substitute");
      if (!/\['Installation identity', view\.identityVerification\]/.test(panel))
        E("V9 the panel does not render the host's identity answer verbatim");
      if (!/\['Protected operations', view\.protectedOperations\]/.test(panel))
        E("V9 the panel does not render the host's protected-operations answer verbatim");
      if (!/\['Readiness', view\.readiness\]/.test(panel))
        E("V9 the panel does not render the host's readiness answer verbatim");

      // No new screen, protocol, pipe or request kind.
      if (/ENDPOINT_PREFIX|CreateNamedPipeW/.test(serve))
        E("V9 the serve module opens a pipe of its own");
      if (/ControllerHello/.test(serve) === false && /ControllerHello/.test(ffi) === false)
        E("V9 the ControllerHello request disappeared from the workflow");
    }
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
