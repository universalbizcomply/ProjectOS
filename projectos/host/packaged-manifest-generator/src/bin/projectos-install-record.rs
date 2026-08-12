//! `projectos-install-record` — emit the canonical installed-application record the MSI installs.
//!
//! WHY A TOOL AND NOT HAND-WRITTEN XML. The record is a versioned, digest-bound contract that the
//! runtime verifies field by field. Authoring its JSON inside a WiX file would be a second,
//! divergent copy of that schema, kept in step by nothing but attention — and the digest would have
//! to be computed by hand. This emits the record through the SAME `InstalledApplicationRecordV1`
//! model and the SAME `compute_application_record_digest` the reader uses, so the two cannot drift.
//!
//! IT VERIFIES WHAT IT WROTE. After serialising, the record is fed back through
//! `verify_application_record` — the real reader, with the real rules — against the same install
//! root the MSI will install to. A record this tool emits is therefore one the runtime accepts, or
//! the tool fails and nothing is written. Generating something the reader would refuse is the
//! failure this closes.
//!
//! IT CONFERS NO TRUST. The record carries no secret, no key material, no anchor selection, no
//! signature algorithm and no project selection. It states installation facts. The strongest thing
//! it can produce downstream is `PerMachineEvidenceMatched` — corroboration, not authentication.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A (MSI installation record writer).

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use projectos_host_identity::{
    compute_application_record_digest, verify_application_record, InstalledApplicationRecordV1,
    APPLICATION_RECORD_SCHEMA_VERSION, PER_MACHINE_SCOPE,
};
use projectos_packaged_runtime_contract as contract;

/// The product this record family accepts. Mirrors `canonical_record::EXPECTED_PRODUCT`, which the
/// reader checks; a mismatch here is caught by the self-verification below rather than shipped.
const EXPECTED_PRODUCT: &str = "ProjectOS";

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

const REQUIRED: [&str; 5] = [
    "--out",
    "--application-version",
    "--install-root",
    "--governed-system-root",
    "--installation-id",
];

fn usage() {
    eprintln!("usage: projectos-install-record {}", REQUIRED.join(" <v> "));
    eprintln!();
    eprintln!("  --out                   where to write the record JSON");
    eprintln!("  --install-root          the directory the MSI installs the application into;");
    eprintln!("                          the runtime compares this against current_exe().parent()");
    eprintln!("  --governed-system-root  the ProjectOS SYSTEM root this installation may operate");
    eprintln!();
    eprintln!(
        "  the application id is NOT an input: it is {}",
        contract::PACKAGED_APPLICATION_ID
    );
    eprintln!();
    eprintln!("Emits the canonical installed-application record and verifies it with the real");
    eprintln!("reader before writing. No secret, no key material, no trust anchor.");
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut values = Vec::new();
    for name in REQUIRED {
        match arg(&args, name) {
            Some(v) => values.push(v),
            None => {
                eprintln!("projectos-install-record: missing {name}");
                usage();
                return ExitCode::from(2);
            }
        }
    }
    let out = PathBuf::from(&values[0]);
    let application_version = values[1].clone();
    let install_root = values[2].clone();
    let governed_system_root = values[3].clone();
    let installation_id = values[4].clone();

    let mut record = InstalledApplicationRecordV1 {
        schema_version: APPLICATION_RECORD_SCHEMA_VERSION,
        product: EXPECTED_PRODUCT.to_string(),
        // The application identity is the packaging contract's. There is no input for it.
        application_id: contract::PACKAGED_APPLICATION_ID.to_string(),
        application_version: application_version.clone(),
        // Only a per-machine installation can corroborate, and this MSI is ALLUSERS=1.
        installation_scope: PER_MACHINE_SCOPE.to_string(),
        install_root: install_root.clone(),
        governed_system_root,
        installation_id,
        record_digest: String::new(),
    };
    record.record_digest = compute_application_record_digest(&record);

    // SELF-VERIFICATION. The real reader, the real rules, the same install root the MSI will use.
    if let Err(e) = verify_application_record(
        &record,
        contract::PACKAGED_APPLICATION_ID,
        &application_version,
        Path::new(&install_root),
    ) {
        eprintln!(
            "projectos-install-record: refused to emit a record the runtime would reject: {e:?}"
        );
        return ExitCode::FAILURE;
    }

    let json = match serde_json::to_string_pretty(&record) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("projectos-install-record: cannot serialise: {e}");
            return ExitCode::FAILURE;
        }
    };
    if let Some(dir) = out.parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!(
                "projectos-install-record: cannot create {}: {e}",
                dir.display()
            );
            return ExitCode::FAILURE;
        }
    }
    if let Err(e) = std::fs::write(&out, json.as_bytes()) {
        eprintln!(
            "projectos-install-record: cannot write {}: {e}",
            out.display()
        );
        return ExitCode::FAILURE;
    }

    println!("installation record : {}", out.display());
    println!("application         : {}", record.application_id);
    println!("version             : {}", record.application_version);
    println!("scope               : {}", record.installation_scope);
    println!("install root        : {}", record.install_root);
    println!("governed system root: {}", record.governed_system_root);
    println!("record digest       : {}", record.record_digest);
    println!();
    println!("Verified with the runtime's own reader. Carries no secret and no trust anchor.");
    ExitCode::SUCCESS
}
