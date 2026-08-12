//! `projectos-manifest-gen` — assemble the packaged payload and emit its unsigned trust manifest.
//!
//! Run AFTER `npm run build:daemon-bundle`, because it packages real artefacts and hashes real
//! bytes. It performs the three steps in the only order that is safe:
//!
//!   assemble → verify closure → generate
//!
//! CLOSURE FAILURE IS FATAL AND HAS NO OVERRIDE FLAG. A payload that reaches back into the
//! development tree does not become acceptable because someone passed `--allow-open-closure`; an
//! escape hatch on a closure gate is the default within two sprints. If closure fails, no manifest
//! is written — there is nothing honest to attest.
//!
//! IT WRITES TWO FILES on success:
//!   * `projectos-trust-manifest.json`      — the unsigned manifest, signature field empty;
//!   * `projectos-trust-manifest.canonical` — exactly the bytes an owner-held key will sign.
//!
//! Emitting the canonical bytes as their own file is deliberate: the signing step must never have to
//! re-derive them, because a second derivation is a second implementation waiting to disagree.
//!
//! IT NEVER INSTALLS. It writes into an output directory and stops. Placing a payload into Program
//! Files, touching a service, an ACL or the registry is installation, and installation is not this
//! tool's business.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use projectos_packaged_manifest_generator::{
    assemble::AssembleInputs, assemble_payload, generate_unsigned_manifest, verify_closure,
    ManifestInputs,
};
use projectos_packaged_runtime_contract as contract;

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

const REQUIRED: [&str; 7] = [
    "--node-exe",
    "--daemon-bundle",
    "--out",
    "--application-version",
    "--build-id",
    "--signing-key-id",
    "--generated-at",
];

fn usage() {
    eprintln!("usage: projectos-manifest-gen {}", REQUIRED.join(" <v> "));
    eprintln!();
    eprintln!("  --node-exe        the candidate Node runtime; must be the pinned bytes");
    eprintln!(
        "                    (sha256 {})",
        contract::PACKAGED_NODE_SHA256
    );
    eprintln!("  --daemon-bundle   the single daemon artefact from `npm run build:daemon-bundle`");
    eprintln!("  --out             payload root to create; must not already contain anything");
    eprintln!();
    eprintln!(
        "  the application id is NOT an input: it is {}",
        contract::PACKAGED_APPLICATION_ID
    );
    eprintln!();
    eprintln!("Assembles, verifies dependency closure, then generates an UNSIGNED manifest.");
    eprintln!("No signature is produced and no key is read. Installation is not performed.");
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut values = Vec::new();
    for name in REQUIRED {
        match arg(&args, name) {
            Some(v) => values.push(v),
            None => {
                eprintln!("projectos-manifest-gen: missing {name}");
                usage();
                return ExitCode::from(2);
            }
        }
    }

    let node_exe = PathBuf::from(&values[0]);
    let daemon_bundle = PathBuf::from(&values[1]);
    let payload_root = PathBuf::from(&values[2]);

    // ---- 1. assemble ----------------------------------------------------------------------------
    let payload = match assemble_payload(&AssembleInputs {
        node_exe: &node_exe,
        daemon_bundle: &daemon_bundle,
        payload_root: &payload_root,
    }) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("projectos-manifest-gen: payload refused — {e:?}");
            return ExitCode::FAILURE;
        }
    };
    println!("payload root  : {}", payload.root.display());
    println!(
        "runtime       : {} ({})",
        contract::RUNTIME_RELATIVE_PATH,
        contract::PACKAGED_NODE_VERSION
    );
    println!("runtime sha256: {}", payload.runtime_sha256);
    println!("daemon        : {}", contract::DAEMON_RELATIVE_PATH);
    println!("daemon sha256 : {}", payload.daemon_sha256);

    // ---- 2. closure -----------------------------------------------------------------------------
    let report = verify_closure(&payload.root);
    if !report.is_closed() {
        eprintln!();
        eprintln!(
            "projectos-manifest-gen: DEPENDENCY CLOSURE FAILED — {} finding(s).",
            report.findings.len()
        );
        eprintln!("The payload reaches outside itself and would only run where the development");
        eprintln!("tree happens to be present. No manifest written.");
        eprintln!();
        for f in &report.findings {
            eprintln!("  {f:?}");
        }
        return ExitCode::FAILURE;
    }
    println!("closure       : CLOSED ({} file(s))", report.files.len());

    // ---- 3. generate ----------------------------------------------------------------------------
    let generated = match generate_unsigned_manifest(&ManifestInputs {
        payload_root: &payload.root,
        application_version: &values[3],
        build_id: &values[4],
        signing_key_id: &values[5],
        generated_at: &values[6],
    }) {
        Ok(g) => g,
        Err(e) => {
            eprintln!("projectos-manifest-gen: refused — {e:?}");
            return ExitCode::FAILURE;
        }
    };

    // ---- the three stages must have seen the SAME bytes ----------------------------------------
    //
    // Assembly, the closure scan and generation each read the payload from disk independently, so
    // in principle the artefact could change between the check and the hash — and the manifest
    // would then attest a daemon that never passed closure. That is precisely the outcome the
    // ordering exists to prevent, so it is checked rather than assumed. It costs one string
    // comparison and it fails closed.
    let assembled = [
        (
            "runtime",
            &payload.runtime_sha256,
            &generated.manifest.runtime.sha256,
        ),
        (
            "daemon",
            &payload.daemon_sha256,
            &generated.manifest.daemon_artefact.sha256,
        ),
    ];
    for (what, at_assembly, at_generation) in assembled {
        if at_assembly != at_generation {
            eprintln!(
                "projectos-manifest-gen: the {what} changed under us — assembled {at_assembly}, \
                 attested {at_generation}. No manifest written."
            );
            return ExitCode::FAILURE;
        }
    }

    let manifest_path = payload.root.join(contract::TRUST_MANIFEST_FILENAME);
    let canonical_path = payload.root.join(contract::CANONICAL_SIGNING_FILENAME);
    if let Err(e) = write(&manifest_path, generated.manifest_json.as_bytes()) {
        eprintln!("projectos-manifest-gen: cannot write manifest: {e}");
        return ExitCode::FAILURE;
    }
    if let Err(e) = write(&canonical_path, &generated.canonical_signing_bytes) {
        eprintln!("projectos-manifest-gen: cannot write canonical bytes: {e}");
        return ExitCode::FAILURE;
    }

    println!("manifest      : {}", manifest_path.display());
    println!("canonical     : {}", canonical_path.display());
    println!("signature     : ABSENT (unsigned) — production identity remains unavailable");
    ExitCode::SUCCESS
}

fn write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, bytes)
}
