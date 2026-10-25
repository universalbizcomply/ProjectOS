//! How the engine brings a NEW filesystem object into existence — RUN-TO-COMPLETION HOST
//! ATTESTATION §10I.
//!
//! The engine creates exactly three kinds of object: the three fixed directories, the single-writer
//! lock file, and the staging file every write goes through before it is renamed into place (records,
//! the manifest and journal entries alike). By default it creates them the way it always has, with
//! the standard library — and a new object then takes whatever descriptor Windows gives it: the
//! parent's inheritable ACEs if it has any, otherwise the creating token's DEFAULT owner and DACL.
//!
//! A GOVERNED store hands the engine an [`ObjectCreation`] instead, and every one of those three
//! creation sites goes through it. The engine still applies no ACL, knows no principal and names no
//! policy; the implementation that does lives with whoever owns the store's custody. Because a rename
//! carries the renamed file's OWN descriptor, governing the staging file is what governs every
//! record, manifest and journal entry the engine ever publishes.

use std::fs::{File, OpenOptions};
use std::path::Path;

use crate::error::DurableStoreError;

/// Creates the objects a GOVERNED store lays out and writes.
///
/// Both methods CREATE ONLY. An implementation must refuse — with
/// [`std::io::ErrorKind::AlreadyExists`] — when anything already exists at the path, and must leave
/// that object exactly as it found it: never open it, never adopt it, never re-secure it. That is
/// what stops a planted object inheriting the store's trust by being "created" a second time.
pub trait ObjectCreation: Send + Sync {
    /// Create `path` as a new directory.
    ///
    /// # Errors
    /// `AlreadyExists` if anything is at `path`; any other error refuses the creation.
    fn create_directory(&self, path: &Path) -> std::io::Result<()>;

    /// Create `path` as a new file, opened for reading and writing.
    ///
    /// # Errors
    /// `AlreadyExists` if anything is at `path`; any other error refuses the creation.
    fn create_file(&self, path: &Path) -> std::io::Result<File>;
}

/// Which route a store's creations take.
pub(crate) enum Creation {
    /// The standard library, exactly as before §10I: the new object takes its descriptor from the
    /// parent's inheritance or the token's defaults.
    Ambient,
    /// Every creation goes through the store owner's [`ObjectCreation`].
    Governed(Box<dyn ObjectCreation>),
}

impl Creation {
    /// Ensure one FIXED directory exists.
    ///
    /// Governed: an existing directory is left alone — its type is checked by the fixed-path
    /// hardening and its descriptor by the store owner — and a missing one is CREATED through the
    /// hook, never through `create_dir_all`, which would create with the ambient descriptor.
    pub(crate) fn directory(&self, path: &Path) -> Result<(), DurableStoreError> {
        match self {
            Self::Ambient => {
                std::fs::create_dir_all(path).map_err(|_| DurableStoreError::InvalidRoot)
            }
            Self::Governed(creator) => {
                if std::fs::symlink_metadata(path).is_ok() {
                    return Ok(());
                }
                match creator.create_directory(path) {
                    Ok(()) => Ok(()),
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
                    Err(_) => Err(DurableStoreError::InvalidRoot),
                }
            }
        }
    }

    /// Open — creating it if absent — the single-writer lock file.
    ///
    /// Governed: an EXISTING lock file is opened as it is (the store owner judges its descriptor);
    /// an absent one is created through the hook.
    pub(crate) fn lock_file(&self, path: &Path) -> Result<File, DurableStoreError> {
        let open_existing = || {
            OpenOptions::new()
                .read(true)
                .write(true)
                .open(path)
                .map_err(|_| DurableStoreError::InvalidRoot)
        };
        match self {
            Self::Ambient => OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(path)
                .map_err(|_| DurableStoreError::InvalidRoot),
            Self::Governed(creator) => {
                if std::fs::symlink_metadata(path).is_ok() {
                    return open_existing();
                }
                match creator.create_file(path) {
                    Ok(file) => Ok(file),
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => open_existing(),
                    Err(_) => Err(DurableStoreError::InvalidRoot),
                }
            }
        }
    }

    /// Create the staging file one write goes through.
    ///
    /// Governed: create-new, so a stale or planted file at the staging name is REFUSED rather than
    /// truncated and published under its planter's descriptor.
    pub(crate) fn staging_file(&self, path: &Path) -> Result<File, DurableStoreError> {
        match self {
            Self::Ambient => File::create(path),
            Self::Governed(creator) => creator.create_file(path),
        }
        .map_err(|_| DurableStoreError::WriteRefusedBeforeEffect)
    }

    /// Whether creations go through a store owner's hook.
    pub(crate) fn is_governed(&self) -> bool {
        matches!(self, Self::Governed(_))
    }
}
