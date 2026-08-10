+++
id = "ownership.moves"
title = "Ownership and moves"
codes = ["E0382", "E0505"]
socraticTemplates = [
  "When you passed that value to the function, what do you think happened to the original binding?",
  "If two names could both free this value when they go out of scope, what would happen at the end of the block?",
  "Which line is the last one that can still legally use this value, and why that one?",
]
checkForUnderstanding = "You can say, in your own words, who owns the value on each line, and what changed at the moment it moved."
+++

Every value in Rust has exactly one owner. When the owner goes out of scope, the value is freed —
that's the whole mechanism, and it's why Rust needs no garbage collector.

A *move* is a transfer of that ownership. When you pass a `String` to a function by value, or assign
it to a new binding, ownership moves and the original binding stops being usable. Rust isn't
copying the value and it isn't hiding a reference; it's saying "this name is no longer responsible
for this memory, and therefore may no longer read it."

The usual first reaction is that this seems arbitrary. It isn't. Imagine both names stayed valid.
At the end of the block, both would free the same allocation — a double free, one of the classic
memory-safety bugs. The move rule is what makes that unrepresentable rather than merely discouraged.

The mental shift that makes this click: stop reading `let b = a;` as "copy a into b" and start
reading it as "b is now responsible for this value; a is done." Types that implement `Copy`
(integers, `bool`, `char`, and tuples of them) are the exception, and they're the exception
precisely because copying them is trivial and they own no heap allocation.

E0382 is Rust telling you a name is being used after its value moved away. E0505 is the same
insight in the other direction: you tried to move a value while someone was still borrowing it.

The three honest ways out, in the order worth considering them: borrow instead of moving (`&value`),
which is usually what you meant; restructure so the value is produced where it's needed rather than
passed around; or clone, which is a real answer when you genuinely need two independent values, and
a smell when it's reflex to silence the compiler.
