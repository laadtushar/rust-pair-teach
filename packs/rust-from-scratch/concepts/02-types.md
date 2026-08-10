+++
id = "basics.types-and-mutability"
title = "Bindings, types and mutability"
codes = ["E0384", "E0308"]
socraticTemplates = [
  "You are assigning to this name a second time — did you tell Rust it was allowed to change?",
  "What type does Rust think this is, and what type does the line below need it to be?",
  "Would making this mutable actually express what you mean, or would a new binding be clearer?",
]
checkForUnderstanding = "You can explain why `let` is immutable by default without calling it annoying."
+++

`let x = 5;` binds a value to a name, and that binding **cannot be reassigned**. To allow change you
say so: `let mut x = 5;`.

This looks like friction and is actually information. In most languages every variable might change
at any point, so reading unfamiliar code means tracking all of them. In Rust, a name without `mut`
is a promise it will not change, which means most names can be read once and then trusted.

Types are inferred but never dynamic. `let x = 5;` makes an `i32` and it stays an `i32` forever.
E0308 — mismatched types — is the compiler telling you the value you produced is not the value the
context needs. Read it as two halves: what it expected, and what it found. The fix is almost always
at one of those two ends, not in the middle.

Shadowing is the escape hatch worth knowing: `let x = 5; let x = x + 1;` is legal and creates a new
binding rather than mutating the old one. Rust programmers use this constantly, especially when
converting a value from one type to another while keeping one good name for it.
