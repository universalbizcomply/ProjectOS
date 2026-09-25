//! Proofs for [`RetainedRequestInbox`]: one open, two consumers, no substitution window.

use std::cell::{Cell, RefCell};
use std::io::Read;

use sha2::{Digest, Sha256};

use crate::{
    InboxReader, InboxRefusal, RequestFileIdentity, RequestLifecycle, RetainedRequestInbox,
    CORRELATION_LEN, DIGEST_LEN, MAX_REQUEST_BODY_BYTES,
};

const CORRELATION: [u8; CORRELATION_LEN] = [0x5a; CORRELATION_LEN];

fn sha(b: &[u8]) -> [u8; DIGEST_LEN] {
    Sha256::digest(b).into()
}

/// An inbox whose file CHANGES between opens, and which counts every open. If anything opened it
/// twice, the second reader would see different bytes - which is exactly the attack.
struct MutatingInbox {
    bodies: RefCell<Vec<Option<Vec<u8>>>>,
    opens: Cell<u32>,
}
impl MutatingInbox {
    fn serving(bodies: Vec<Option<Vec<u8>>>) -> Self {
        Self {
            bodies: RefCell::new(bodies),
            opens: Cell::new(0),
        }
    }
}
impl InboxReader for MutatingInbox {
    fn open_once(&self, _i: &RequestFileIdentity) -> Option<Box<dyn Read + '_>> {
        self.opens.set(self.opens.get() + 1);
        let mut bodies = self.bodies.borrow_mut();
        let next = if bodies.is_empty() {
            None
        } else {
            bodies.remove(0)
        };
        next.map(|b| Box::new(std::io::Cursor::new(b)) as Box<dyn Read + '_>)
    }
}

/// THE PROPERTY: the bytes hashed for composition ARE the bytes the operation executes, and the file
/// was opened once - even though it changed underneath.
#[test]
fn the_hashed_bytes_are_the_executed_bytes_and_the_file_is_opened_once() {
    let real = MutatingInbox::serving(vec![
        Some(b"the question".to_vec()),
        Some(b"a swap".to_vec()),
    ]);
    let mut inbox = RetainedRequestInbox::over(&real);

    let digest = inbox.read_once(&CORRELATION).expect("a body");
    assert_eq!(digest, sha(b"the question"));

    let identity = RequestFileIdentity::for_correlation(&CORRELATION);
    let mut lifecycle = RequestLifecycle::new();
    let body = lifecycle
        .accept_once(&inbox, &identity, &digest)
        .expect("the retained bytes verify");

    assert_eq!(body.bytes(), b"the question");
    assert_eq!(
        real.opens.get(),
        1,
        "the underlying inbox was opened exactly once"
    );
}

/// The retained bytes answer ONCE. A second execution under the same identity finds nothing, and the
/// underlying inbox is still never consulted.
#[test]
fn retained_bytes_are_served_exactly_once() {
    let real = MutatingInbox::serving(vec![Some(b"q".to_vec()), Some(b"q".to_vec())]);
    let mut inbox = RetainedRequestInbox::over(&real);
    inbox.read_once(&CORRELATION).expect("a body");
    let identity = RequestFileIdentity::for_correlation(&CORRELATION);

    assert!(inbox.open_once(&identity).is_some());
    assert!(inbox.open_once(&identity).is_none());
    assert_eq!(real.opens.get(), 1);
}

/// A request composition never read is NOT THERE, whatever the real inbox holds.
#[test]
fn an_unread_identity_never_falls_through_to_the_real_inbox() {
    let real = MutatingInbox::serving(vec![Some(b"q".to_vec())]);
    let inbox = RetainedRequestInbox::over(&real);
    let identity = RequestFileIdentity::for_correlation(&CORRELATION);

    assert!(inbox.open_once(&identity).is_none());
    let mut lifecycle = RequestLifecycle::new();
    assert_eq!(
        lifecycle.accept_once(&inbox, &identity, &sha(b"q")),
        Err(InboxRefusal::RequestNotPresent)
    );
    assert_eq!(real.opens.get(), 0);
}

/// Retained bytes are served only for the identity they were read under.
#[test]
fn retained_bytes_are_not_served_to_another_identity() {
    let real = MutatingInbox::serving(vec![Some(b"q".to_vec())]);
    let mut inbox = RetainedRequestInbox::over(&real);
    inbox.read_once(&CORRELATION).expect("a body");

    let other = RequestFileIdentity::for_correlation(&[0x5b; CORRELATION_LEN]);
    assert!(inbox.open_once(&other).is_none());
    // ...and the refused ask did not discard the body the right identity is owed.
    let identity = RequestFileIdentity::for_correlation(&CORRELATION);
    assert!(inbox.open_once(&identity).is_some());
}

/// A correlation is SPENT by any answer, so a replayed correlation is not read again.
#[test]
fn a_correlation_is_read_at_most_once() {
    let real = MutatingInbox::serving(vec![Some(b"q".to_vec()), Some(b"q".to_vec())]);
    let mut inbox = RetainedRequestInbox::over(&real);

    assert!(inbox.read_once(&CORRELATION).is_some());
    assert!(inbox.read_once(&CORRELATION).is_none());
    assert_eq!(real.opens.get(), 1);
}

/// ABSENCE IS A RACE, NOT AN ANSWER: a request that was not there yet may be read when it arrives.
#[test]
fn an_absent_request_does_not_spend_the_correlation() {
    let real = MutatingInbox::serving(vec![None, Some(b"late".to_vec())]);
    let mut inbox = RetainedRequestInbox::over(&real);

    assert!(inbox.read_once(&CORRELATION).is_none());
    assert_eq!(inbox.read_once(&CORRELATION), Some(sha(b"late")));
}

/// An oversized body is refused under the same cap, spends the correlation and retains nothing.
#[test]
fn an_oversized_body_is_refused_spent_and_not_retained() {
    let real = MutatingInbox::serving(vec![Some(vec![b'x'; MAX_REQUEST_BODY_BYTES + 1])]);
    let mut inbox = RetainedRequestInbox::over(&real);

    assert!(inbox.read_once(&CORRELATION).is_none());
    assert!(inbox.read_once(&CORRELATION).is_none());
    let identity = RequestFileIdentity::for_correlation(&CORRELATION);
    assert!(inbox.open_once(&identity).is_none());
    assert_eq!(real.opens.get(), 1);
}

/// At most one subject is ever held: reading a later correlation drops an unexecuted earlier body.
#[test]
fn a_later_read_drops_an_unexecuted_earlier_body() {
    let real = MutatingInbox::serving(vec![Some(b"first".to_vec()), Some(b"second".to_vec())]);
    let mut inbox = RetainedRequestInbox::over(&real);
    inbox.read_once(&CORRELATION).expect("first");
    inbox.read_once(&[0x5b; CORRELATION_LEN]).expect("second");

    let first = RequestFileIdentity::for_correlation(&CORRELATION);
    assert!(inbox.open_once(&first).is_none());
}
