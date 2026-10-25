//! The transaction lifecycle. A transaction captures one store-issued identity and one base
//! revision, stages isolated changes, and reaches exactly one terminal state (committed, rolled
//! back, or failed). Transactions are in-process and non-serializable; they hold no live authority.

use std::fmt;

use crate::error::StoreError;
use crate::model::{RecordFamily, StoreRevision, StoredRecord};
use crate::store::MAX_STAGED_OPS;

/// The state of a transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TxState {
    /// Open — may stage and then commit or roll back.
    Open,
    /// Committed (terminal).
    Committed,
    /// Rolled back (terminal).
    RolledBack,
    /// Failed (terminal).
    Failed,
}

/// A staged mutation action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Insert a new record (key must not exist).
    Insert,
    /// Replace an existing record (key must exist).
    Replace,
    /// Remove an existing record (key must exist).
    Remove,
}

/// A test-only commit stage at which a deterministic failure is injected. `#[doc(hidden)]`: this is
/// NOT a general production fault hook — it only short-circuits `commit` at a defined synthetic stage
/// and is used solely to prove atomicity.
#[doc(hidden)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InjectStage {
    /// Fail before any validation runs.
    BeforeValidation,
    /// Fail after validation but before the committed-state swap.
    AfterValidation,
    /// Fail immediately before the committed-state swap.
    BeforeSwap,
}

/// One staged operation. No `Debug`: it holds a full DTO whose contents must never render.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct StagedOp {
    pub(crate) action: Action,
    pub(crate) family: RecordFamily,
    pub(crate) key: String,
    pub(crate) record: Option<StoredRecord>,
}

/// A store transaction. `Debug` is redacted: it never renders staged record contents.
#[derive(Clone)]
pub struct Transaction {
    pub(crate) id: u64,
    pub(crate) base: StoreRevision,
    pub(crate) staged: Vec<StagedOp>,
    pub(crate) state: TxState,
    pub(crate) inject: Option<InjectStage>,
}

impl fmt::Debug for Transaction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Transaction")
            .field("id", &self.id)
            .field("base", &self.base.value())
            .field("state", &self.state)
            .field("staged", &self.staged.len())
            .field("inject_scheduled", &self.inject.is_some())
            .finish()
    }
}

impl Transaction {
    /// The store-issued transaction identity.
    #[must_use]
    pub fn id(&self) -> u64 {
        self.id
    }
    /// The base store revision this transaction was opened against.
    #[must_use]
    pub fn base_revision(&self) -> StoreRevision {
        self.base
    }
    /// The current transaction state.
    #[must_use]
    pub fn state(&self) -> TxState {
        self.state
    }
    /// The number of staged operations.
    #[must_use]
    pub fn staged_len(&self) -> usize {
        self.staged.len()
    }

    /// Stage an insert of `record` under `key`.
    ///
    /// # Errors
    /// [`StoreError::InvalidTransactionState`] if not open; [`StoreError::ResourceLimit`] if the
    /// staged-operation bound is exceeded.
    pub fn insert(
        &mut self,
        key: impl Into<String>,
        record: StoredRecord,
    ) -> Result<(), StoreError> {
        let family = record.family();
        self.stage(StagedOp {
            action: Action::Insert,
            family,
            key: key.into(),
            record: Some(record),
        })
    }

    /// Stage a replace of the record under `key`.
    ///
    /// # Errors
    /// As [`Transaction::insert`].
    pub fn replace(
        &mut self,
        key: impl Into<String>,
        record: StoredRecord,
    ) -> Result<(), StoreError> {
        let family = record.family();
        self.stage(StagedOp {
            action: Action::Replace,
            family,
            key: key.into(),
            record: Some(record),
        })
    }

    /// Stage a remove of the record under `key` in `family`.
    ///
    /// # Errors
    /// As [`Transaction::insert`].
    pub fn remove(
        &mut self,
        family: RecordFamily,
        key: impl Into<String>,
    ) -> Result<(), StoreError> {
        self.stage(StagedOp {
            action: Action::Remove,
            family,
            key: key.into(),
            record: None,
        })
    }

    /// TEST-ONLY: schedule a deterministic failure at a defined commit stage. `#[doc(hidden)]`.
    #[doc(hidden)]
    pub fn inject_failure_for_test(&mut self, stage: InjectStage) {
        self.inject = Some(stage);
    }

    fn stage(&mut self, op: StagedOp) -> Result<(), StoreError> {
        if self.state != TxState::Open {
            return Err(StoreError::InvalidTransactionState);
        }
        if self.staged.len() >= MAX_STAGED_OPS {
            return Err(StoreError::ResourceLimit);
        }
        self.staged.push(op);
        Ok(())
    }
}
