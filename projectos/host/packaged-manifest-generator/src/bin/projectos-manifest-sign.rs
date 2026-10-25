//! `projectos-manifest-sign` — the owner-controlled signing interface. IT NEVER SIGNS.
//!
//! WHAT IT DOES NOT DO, and has no code for: read a private key, import one, generate one, persist
//! one, print one, copy one into the installer or into ProgramData, or log one. There is no
//! parameter through which a private key could be passed, so this is a property of the interface
//! rather than of its discipline. The owner's key stays outside ProjectOS, permanently.
//!
//! THE CEREMONY IS THREE STEPS, and only the middle one is the owner's:
//!
//!   1. `describe` — ProjectOS states exactly what must be signed and in what format.
//!   2. the OWNER signs those exact bytes, with their own key, using their own tool. One bounded
//!      operation, on a file. Nothing of ProjectOS's is involved.
//!   3. `attach` — ProjectOS takes the detached signature and the PUBLIC key, verifies the signature
//!      really covers the canonical bytes, and only then writes it into the manifest.
//!
//! `attach` verifying before writing is the point: a signature that does not check out is refused
//! rather than stored, so a manifest can never carry a signature nobody validated. `verify` repeats
//! the check on demand.
//!
//! ATTACHING IS NOT TRUSTING. A signed manifest still only becomes production identity when the
//! signing key is the one this build EMBEDS as its anchor. This tool cannot provision an anchor and
//! does not try to.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A (installer trust record + release candidate).

use std::path::PathBuf;
use std::process::ExitCode;

use projectos_host_identity::{
    canonical_bytes, decode_hex, verify_es256, TrustManifest, PRODUCTION_ALGORITHM,
    RAW_P256_SIGNATURE_LEN, UNCOMPRESSED_P256_POINT_LEN,
};
use projectos_packaged_runtime_contract as contract;

/// Test key ids are refused under production policy by `evaluate()`; refusing them here too means an
/// owner cannot accidentally produce a manifest that can never be accepted.
const TEST_KEY_ID_PREFIX: &str = "TEST-ONLY-";

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn usage() {
    eprintln!("usage:");
    eprintln!("  projectos-manifest-sign describe --payload <payload root>");
    eprintln!(
        "  projectos-manifest-sign attach   --payload <root> --signature <file.hex> \\
                                   --public-key <hex|@file> --signing-key-id <id>"
    );
    eprintln!("  projectos-manifest-sign verify   --payload <root> --public-key <hex|@file>");
    eprintln!();
    eprintln!(
        "This tool NEVER reads, holds, writes or prints a private key. There is no flag for one."
    );
}

/// Read a hex value given either literally or as `@path`, so a long value need not go on a command
/// line — and, more importantly, so it need not appear in shell history.
fn read_hex(value: &str) -> Result<Vec<u8>, String> {
    let text = match value.strip_prefix('@') {
        Some(path) => {
            std::fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?
        }
        None => value.to_string(),
    };
    let cleaned: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    decode_hex(&cleaned).ok_or_else(|| "value is not lower-case hexadecimal".to_string())
}

struct Payload {
    root: PathBuf,
    manifest_path: PathBuf,
    canonical_path: PathBuf,
}

fn payload(root: &str) -> Result<Payload, String> {
    let root = PathBuf::from(root);
    let manifest_path = root.join(contract::TRUST_MANIFEST_FILENAME);
    let canonical_path = root.join(contract::CANONICAL_SIGNING_FILENAME);
    for p in [&manifest_path, &canonical_path] {
        if !p.is_file() {
            return Err(format!(
                "not a generated payload: {} is missing",
                p.display()
            ));
        }
    }
    Ok(Payload {
        root,
        manifest_path,
        canonical_path,
    })
}

/// Load the manifest and confirm the canonical file really is ITS canonical form.
///
/// Without this the tool would happily sign one artefact and attach the result to another: the two
/// files sit side by side and nothing else ties them together.
fn load_bound(p: &Payload) -> Result<(TrustManifest, Vec<u8>), String> {
    let raw = std::fs::read(&p.manifest_path).map_err(|e| format!("cannot read manifest: {e}"))?;
    let manifest: TrustManifest =
        serde_json::from_slice(&raw).map_err(|e| format!("manifest is not valid: {e}"))?;
    let on_disk = std::fs::read(&p.canonical_path)
        .map_err(|e| format!("cannot read canonical bytes: {e}"))?;
    let derived = canonical_bytes(&manifest);
    if on_disk != derived {
        return Err(format!(
            "{} is not the canonical form of {} — regenerate the payload",
            p.canonical_path.display(),
            p.manifest_path.display()
        ));
    }
    Ok((manifest, on_disk))
}

fn sha256_hex_of(bytes: &[u8]) -> String {
    projectos_host_identity::sha256_hex(bytes)
}

fn describe(p: &Payload) -> Result<(), String> {
    let (manifest, canonical) = load_bound(p)?;
    println!("PROJECTOS OWNER SIGNING CEREMONY");
    println!();
    println!("payload root        : {}", p.root.display());
    println!(
        "application         : {} {}",
        manifest.application_id, manifest.application_version
    );
    println!("build id            : {}", manifest.build_id);
    println!(
        "currently signed    : {}",
        if manifest.signature.is_empty() {
            "NO — unsigned"
        } else {
            "yes"
        }
    );
    println!();
    println!("SIGN EXACTLY THIS FILE, byte for byte, with no re-serialisation:");
    println!("  file              : {}", p.canonical_path.display());
    println!("  bytes             : {}", canonical.len());
    println!("  sha256            : {}", sha256_hex_of(&canonical));
    println!();
    println!("ALGORITHM           : ECDSA P-256 with SHA-256 (\"{PRODUCTION_ALGORITHM}\")");
    println!("SIGNATURE FORMAT    : RAW r||s, {RAW_P256_SIGNATURE_LEN} bytes, lower-case hex");
    println!(
        "                      ({} hex characters). NOT DER/ASN.1.",
        RAW_P256_SIGNATURE_LEN * 2
    );
    println!(
        "PUBLIC KEY FORMAT   : uncompressed P-256 point, {UNCOMPRESSED_P256_POINT_LEN} bytes,"
    );
    println!(
        "                      0x04 || X || Y, lower-case hex ({} characters).",
        UNCOMPRESSED_P256_POINT_LEN * 2
    );
    println!("KEY ID              : any stable non-empty string that does NOT begin with");
    println!(
        "                      \"{TEST_KEY_ID_PREFIX}\". It is recorded in the manifest and must"
    );
    println!("                      match the anchor this build embeds.");
    println!();
    println!("THEN:");
    println!(
        "  projectos-manifest-sign attach --payload {} \\",
        p.root.display()
    );
    println!("      --signature <detached.hex> --public-key <@public.hex> --signing-key-id <id>");
    println!();
    println!(
        "ProjectOS never sees the private key. Do not paste it anywhere, including into a chat."
    );
    Ok(())
}

fn verify_detached(canonical: &[u8], public_key: &[u8], signature: &[u8]) -> Result<(), String> {
    if public_key.len() != UNCOMPRESSED_P256_POINT_LEN || public_key[0] != 0x04 {
        return Err(format!(
            "public key must be {UNCOMPRESSED_P256_POINT_LEN} bytes beginning 0x04 (uncompressed P-256 point)"
        ));
    }
    if signature.len() != RAW_P256_SIGNATURE_LEN {
        return Err(format!(
            "signature must be {RAW_P256_SIGNATURE_LEN} raw bytes (r||s), not DER — got {}",
            signature.len()
        ));
    }
    verify_es256(public_key, canonical, signature)
        .map_err(|_| "the signature does NOT verify over the canonical bytes".to_string())
}

fn attach(
    p: &Payload,
    signature_hex: &str,
    public_key_hex: &str,
    key_id: &str,
) -> Result<(), String> {
    if key_id.trim().is_empty() {
        return Err("a signing key id is required".to_string());
    }
    if key_id.starts_with(TEST_KEY_ID_PREFIX) {
        return Err(format!(
            "\"{TEST_KEY_ID_PREFIX}…\" key ids are refused under production policy; this manifest could never be accepted"
        ));
    }
    let (mut manifest, canonical) = load_bound(p)?;
    let signature = read_hex(signature_hex)?;
    let public_key = read_hex(public_key_hex)?;

    // VERIFY BEFORE WRITING. A signature that does not check out is refused rather than stored.
    verify_detached(&canonical, &public_key, &signature)?;

    manifest.signature_algorithm = PRODUCTION_ALGORITHM.to_string();
    manifest.signing_key_id = key_id.to_string();
    manifest.signature = signature.iter().fold(String::new(), |mut acc, b| {
        use std::fmt::Write as _;
        let _ = write!(acc, "{b:02x}");
        acc
    });

    // The canonical bytes must be unchanged by signing — the signature is not part of what it
    // covers. If this ever failed, the signature would have invalidated its own input.
    let after = canonical_bytes(&manifest);
    if after != canonical {
        return Err("attaching the signature changed the canonical bytes — refusing".to_string());
    }

    let json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("cannot serialise manifest: {e}"))?;
    std::fs::write(&p.manifest_path, json.as_bytes())
        .map_err(|e| format!("cannot write manifest: {e}"))?;

    println!("signature attached to {}", p.manifest_path.display());
    println!("  key id    : {key_id}");
    println!("  algorithm : {PRODUCTION_ALGORITHM}");
    println!();
    println!("The manifest is now SIGNED. It becomes production identity only on a build whose");
    println!("EMBEDDED ANCHOR is this key — attaching a signature does not provision an anchor.");
    Ok(())
}

fn verify(p: &Payload, public_key_hex: &str) -> Result<(), String> {
    let (manifest, canonical) = load_bound(p)?;
    if manifest.signature.is_empty() {
        return Err("the manifest is UNSIGNED".to_string());
    }
    if manifest.signature_algorithm != PRODUCTION_ALGORITHM {
        return Err(format!(
            "manifest names algorithm {:?}; only {PRODUCTION_ALGORITHM} is supported",
            manifest.signature_algorithm
        ));
    }
    let public_key = read_hex(public_key_hex)?;
    let signature = decode_hex(&manifest.signature)
        .ok_or_else(|| "manifest signature is not lower-case hex".to_string())?;
    verify_detached(&canonical, &public_key, &signature)?;
    println!("signature VERIFIES over {}", p.canonical_path.display());
    println!("  key id    : {}", manifest.signing_key_id);
    println!("  algorithm : {}", manifest.signature_algorithm);
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(command) = args.first().cloned() else {
        usage();
        return ExitCode::from(2);
    };
    let Some(root) = arg(&args, "--payload") else {
        eprintln!("projectos-manifest-sign: missing --payload");
        usage();
        return ExitCode::from(2);
    };
    let p = match payload(&root) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("projectos-manifest-sign: {e}");
            return ExitCode::FAILURE;
        }
    };

    let outcome = match command.as_str() {
        "describe" => describe(&p),
        "attach" => match (
            arg(&args, "--signature"),
            arg(&args, "--public-key"),
            arg(&args, "--signing-key-id"),
        ) {
            (Some(sig), Some(key), Some(id)) => attach(&p, &sig, &key, &id),
            _ => Err("attach needs --signature, --public-key and --signing-key-id".to_string()),
        },
        "verify" => match arg(&args, "--public-key") {
            Some(key) => verify(&p, &key),
            None => Err("verify needs --public-key".to_string()),
        },
        other => Err(format!("unknown command {other:?}")),
    };

    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("projectos-manifest-sign: {e}");
            ExitCode::FAILURE
        }
    }
}

/// The private-key surface is EMPTY, and this proves it against the source rather than by assertion.
#[cfg(test)]
mod tests {
    /// No flag, environment variable or file this tool reads is a private key. The scan is over the
    /// stripped source so the prose above — which necessarily discusses private keys — cannot
    /// satisfy or break it.
    #[test]
    fn the_tool_has_no_private_key_input() {
        let src = include_str!("projectos-manifest-sign.rs");
        // Cut the file at THIS test module, then strip line comments. Both are necessary and for the
        // same reason: the prose above discusses private keys at length, and the list below is
        // literally the strings being forbidden. A scan that reads its own forbidden list as
        // evidence can only ever fail — which is exactly what it did, three separate times across
        // this phase, before the rule was written down.
        let production = &src[..src.find("#[cfg(test)]").unwrap_or(src.len())];
        let code: String = production
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        for forbidden in [
            "--private-key",
            "private_key",
            "PRIVATE KEY",
            "BEGIN EC PRIVATE",
            "sign_es256",
            "NCryptSignHash",
        ] {
            assert!(
                !code.contains(forbidden),
                "the signing tool must have no private-key surface, found {forbidden}"
            );
        }
    }
}
