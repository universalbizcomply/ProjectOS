"""PROJECTOS-HOST-REVIEW-PATH1B (ROUTE A) — widen the production-relevant cfgs in host-authority.

Widens `#[cfg(feature = "test-fixtures")]` to
`#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]`
in security.rs, then REVERTS the ones that must stay fixture-only, so the production graph gets the
machine-wide descriptor + the accepted read-only DACL inspection and NONE of the synthetic
constructors.

Idempotent: re-running changes nothing.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEC = ROOT / "projectos" / "host" / "host-authority" / "src" / "security.rs"

OLD = '#[cfg(feature = "test-fixtures")]'
NEW = '#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]'

# Items that MUST remain fixture-only. The cfg immediately preceding each of these reverts.
FIXTURE_ONLY = (
    "pub fn build_empty_dacl_for_test",
    "pub fn build_all_access_everyone_for_test",
    "pub fn build_null_dacl_for_test",
    "pub fn build_synthetic_for_test",
    "pub fn build_synthetic_production_for_test",
    # NOTE: `OwnedInfoDescriptor` is deliberately NOT in this list. It is the RAII wrapper that frees
    # the descriptor returned by the accepted READ-ONLY DACL inspection (`inspect_object_security`),
    # which the production acquisition graph needs and which the ruling permits ("read-only handle
    # access required by the accepted checks"). It constructs no synthetic security of any kind.
)


def main() -> int:
    text = SEC.read_text(encoding="utf-8")
    before = text

    # 1. Widen every occurrence.
    text = text.replace(OLD, NEW)

    # 2. Revert the ones guarding a fixture-only item. Walk the lines and, whenever a widened cfg is
    #    followed (skipping attributes, doc comments and blank lines) by a fixture-only item, put the
    #    narrow cfg back.
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if line.strip() != NEW:
            continue
        for j in range(i + 1, min(i + 8, len(lines))):
            nxt = lines[j].strip()
            if not nxt or nxt.startswith("///") or nxt.startswith("//") or nxt.startswith("#["):
                continue
            if any(marker in nxt for marker in FIXTURE_ONLY):
                indent = line[: len(line) - len(line.lstrip())]
                lines[i] = indent + OLD
            break
    text = "\n".join(lines)

    if text == before:
        print("security.rs: no change (already patched)")
        return 0
    SEC.write_text(text, encoding="utf-8", newline="")
    widened = text.count(NEW)
    narrow = text.count(OLD)
    print(f"security.rs: widened={widened} fixture-only-retained={narrow}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
