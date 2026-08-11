+++
id = "modules.visibility"
title = "Where code lives and who can see it"
codes = ["E0433", "E0432", "E0603"]
socraticTemplates = [
  "The compiler cannot find this name — is the file declared as a module anywhere?",
  "Is the thing you are importing marked `pub`?",
  "Starting from the crate root, what is the full path to this item?",
]
checkForUnderstanding = "You can say the full path from crate root to an item, and why the compiler could or could not reach it."
+++

Creating `src/parser.rs` does **not** make it part of your program. Rust needs to be told, with
`mod parser;` in `main.rs` or `lib.rs`. This trips up nearly everyone coming from languages where
files are modules automatically, and it is why E0433 so often appears right after you split a file.

**E0433 — failed to resolve.** The name does not exist along the path you gave. Usually a missing
`mod` declaration, a typo, or a missing dependency in `Cargo.toml`.

**E0432 — unresolved import.** The `use` line points at something that is not there. Same causes.

**E0603 — private.** The item exists and the compiler can see it, but you are not allowed to. Items
are private by default in Rust: a module is a wall unless you put a door in it with `pub`.

The default is deliberate. It means the public surface of a module is exactly what you wrote `pub`
on, so you can change everything else without breaking anyone. When you hit E0603, the question is
not "how do I get past this" but "should this be part of this module's public interface?" Sometimes
the honest answer is no, and the code that wants it belongs somewhere else.
