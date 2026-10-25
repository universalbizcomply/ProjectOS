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

const REQUIRED: [&str; 10] = [
    "--daemon-bundle",
    "--out",
    // THE INSTALLATION whose committed execution closure is attested. Required, never defaulted:
    // a default would silently attest whichever repository the build happened to run in, and the
    // resulting manifest would look exactly like a correct one.
    "--install-root",
    "--application-version",
    "--build-id",
    "--signing-key-id",
    "--generated-at",
    // THE OWNER'S POLICY FACTS (PROJECTOS-HOST-REVIEW-PATH1B). Required, never defaulted: a default cost
    // would be a cost nobody approved, and a default model policy or credential reference would be an
    // identity the owner never chose. The signature that later covers them is the owner's.
    "--admitted-review-cost-micro-usd",
    "--model-policy",
    "--credential-ref",
];

fn usage() {
    eprintln!("usage: projectos-manifest-gen {}", REQUIRED.join(" <v> "));
    eprintln!();
    eprintln!("  --node-exe        OPTIONAL candidate Node runtime; must be the pinned bytes.");
    eprintln!(
        "                    defaults to {}",
        contract::PACKAGED_NODE_PROVENANCE
    );
    eprintln!(
        "                    (sha256 {})",
        contract::PACKAGED_NODE_SHA256
    );
    eprintln!("  --daemon-bundle   the single daemon artefact from `npm run build:daemon-bundle`");
    eprintln!("  --out             payload root to create; must not already contain anything");
    eprintln!(
        "  --install-root    the ProjectOS installation whose committed EXECUTION CLOSURE is"
    );
    eprintln!(
        "                    attested. These artefacts are NOT copied into the payload — they"
    );
    eprintln!(
        "                    stay where the broker's committed-bytes reader expects them, and"
    );
    eprintln!(
        "                    the manifest records their digests so an owner signature can say"
    );
    eprintln!("                    the committed bytes are the approved ones:");
    for rel in contract::EXECUTION_CLOSURE_REPOSITORY_PATHS {
        eprintln!("                      {rel}");
    }
    eprintln!();
    eprintln!(
        "  the application id is NOT an input: it is {}",
        contract::PACKAGED_APPLICATION_ID
    );
    eprintln!();
    eprintln!("Assembles, verifies dependency closure, then generates an UNSIGNED manifest.");
    eprintln!("No signature is produced and no key is read. Installation is not performed.");
}

/// Refuse to attest execution-closure bytes that are not the COMMITTED bytes.
///
/// THE GAP THIS CLOSES. The generator hashes the artefacts as they sit on disk, while the run-time
/// reader hashes what `git show HEAD:./<rel>` returns. Those are the same bytes in a clean checkout —
/// but an operator with an uncommitted local edit to the broker, the allowlist or the adapter would
/// otherwise produce a manifest attesting bytes that were never committed at all, and an owner could
/// be asked to sign a digest that corresponds to no commit. The verifier would later refuse it, with
/// a mismatch nobody could explain.
///
/// IT LIVES IN THE BINARY, NOT THE LIBRARY. The packaging library is required to contain no
/// `Command::new` and no environment lookup, and that invariant is asserted by its own tests: a
/// packaged runtime is bound by the contract, never discovered. A build-time refusal is a different
/// thing from a runtime trust decision, so it belongs on this side of that line.
///
/// IT FAILS CLOSED. If git cannot be run at all, the answer is "this could not be established",
/// which is a refusal — never a pass. A `git` that is merely absent from PATH stops a packaging run,
/// which is the correct outcome: nothing here can honestly attest committedness without it.
fn execution_closure_is_committed_and_clean(install_root: &Path) -> Result<(), String> {
    for rel in contract::EXECUTION_CLOSURE_REPOSITORY_PATHS {
        let run = |args: &[&str]| -> Result<String, String> {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(install_root)
                .args(args)
                .output()
                .map_err(|e| format!("git could not be run to check {rel}: {e}"))?;
            if !out.status.success() {
                return Err(format!(
                    "git refused to answer for {rel}: {}",
                    String::from_utf8_lossy(&out.stderr).trim()
                ));
            }
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
        };

        if run(&["log", "-1", "--format=%H", "--", rel])?.is_empty() {
            return Err(format!("{rel} is not committed at HEAD"));
        }
        if !run(&["diff", "--name-only", "HEAD", "--", rel])?.is_empty() {
            return Err(format!(
                "{rel} differs from HEAD in the working tree; commit it or restore it before \
                 generating a manifest that attests it"
            ));
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    for name in REQUIRED {
        if arg(&args, name).is_none() {
            eprintln!("projectos-manifest-gen: missing {name}");
            usage();
            return ExitCode::from(2);
        }
    }
    // BY NAME, NOT BY POSITION. The values used to be pushed into a vector and read back as
    // `values[2]`, which silently reassigns every later argument the moment a new one is added to
    // `REQUIRED` — a build id would become an application version and the manifest would be wrong in
    // a way nothing here could detect. Presence is proven above, so these lookups cannot be absent;
    // an empty value still fails closed downstream, where blank required fields are refused.
    let value = |name: &str| arg(&args, name).unwrap_or_default();

    // The runtime source DEFAULTS to the provenance the packaging contract recorded, so a fresh
    // checkout needs no hidden preparation and no machine-specific flag. An override exists because
    // a build machine may keep Node elsewhere — and it is safe to allow, because the size and
    // SHA-256 pin refuse anything that is not the exact runtime this build packages. Choosing WHERE
    // to read the bytes from is not the same as choosing WHICH bytes are acceptable.
    let node_exe = arg(&args, "--node-exe")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(contract::PACKAGED_NODE_PROVENANCE));
    let daemon_bundle = PathBuf::from(value("--daemon-bundle"));
    let payload_root = PathBuf::from(value("--out"));
    let install_root = PathBuf::from(value("--install-root"));

    // ---- 0. the execution closure must be committed AND clean -----------------------------------
    //
    // Checked FIRST, before 91 MB are copied: a run that cannot honestly attest the closure should
    // not do any work at all, and the operator should hear the real reason immediately.
    if let Err(why) = execution_closure_is_committed_and_clean(&install_root) {
        eprintln!("projectos-manifest-gen: EXECUTION CLOSURE REFUSED — {why}");
        eprintln!("The manifest would attest bytes the run-time committed-bytes reader will never");
        eprintln!("see. No payload assembled, no manifest written.");
        return ExitCode::FAILURE;
    }

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
    // A cost that is not a whole number of micro-USD is refused rather than rounded or defaulted.
    let admitted_cost: u64 = match value("--admitted-review-cost-micro-usd").parse() {
        Ok(n) => n,
        Err(_) => {
            eprintln!("projectos-manifest-gen: refused — --admitted-review-cost-micro-usd is not a whole number");
            return ExitCode::FAILURE;
        }
    };
    let generated = match generate_unsigned_manifest(&ManifestInputs {
        payload_root: &payload.root,
        install_root: &install_root,
        application_version: &value("--application-version"),
        build_id: &value("--build-id"),
        signing_key_id: &value("--signing-key-id"),
        generated_at: &value("--generated-at"),
        admitted_review_cost_micro_usd: admitted_cost,
        model_policy: &value("--model-policy"),
        credential_ref: &value("--credential-ref"),
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

    // The attested-but-not-packaged half, printed so a packager can see exactly what the owner will
    // be asked to sign. Labelled `attested` rather than `packaged` on purpose: none of these files
    // is in the payload, and a report that blurred the two would misdescribe the trust model.
    if let Some(c) = generated.manifest.execution_closure.as_ref() {
        println!("manifest ver  : {}", generated.manifest.manifest_version);
        for a in [
            &c.gatekeeper_broker,
            &c.installation_project_allowlist,
            &c.credential_adapter,
        ] {
            println!(
                "attested      : {} {}",
                a.repository_relative_path, a.sha256
            );
        }
    }
    println!("manifest      : {}", manifest_path.display());
    println!("canonical     : {}", canonical_path.display());
    println!("signature     : ABSENT (unsigned) — production identity remains unavailable");
    ExitCode::SUCCESS
}

fn write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, bytes)
}
