+++
id = "borrows.conflicting"
title = "Shared and mutable borrows"
codes = ["E0499", "E0502"]
socraticTemplates = [
  "How many live references to this value exist on the failing line, and which of them can write?",
  "If the mutation were allowed to happen here, what could the other reference be pointing at afterwards?",
  "Where does the first borrow actually stop being used — is it where you expected?",
]
checkForUnderstanding = "You can point at the exact span where each borrow starts and ends, and say which pair overlaps."
+++

Rust's second rule, after single ownership: at any moment you may have *either* any number of shared
references (`&T`) *or* exactly one mutable reference (`&mut T`) — never both.

This is not bureaucracy. Consider `Vec`: pushing to it may reallocate its buffer, and every existing
reference into the old buffer becomes a dangling pointer. A shared reference held across a `push` is
therefore not a stylistic problem, it's a use-after-free waiting to happen. The rule turns that
entire class of bug into a compile error. The same rule is also what makes data races impossible in
safe concurrent Rust — a race needs two accesses where one writes, and that's exactly the shape
being forbidden.

The part that trips people up is *when a borrow ends*. Modern Rust uses non-lexical lifetimes: a
borrow lives until its last use, not until the end of the enclosing block. So this compiles fine:

```
let first = &items[0];
println!("{first}");      // last use of `first` — the borrow ends here
items.push(4);            // fine
```

and this does not:

```
let first = &items[0];
items.push(4);            // conflicts: `first` is used again below
println!("{first}");
```

Identical lines, different order, different answer. When an error surprises you, the question to ask
is almost never "why is this rule so strict" and almost always "where is the last use of the first
borrow?" — because that's the invisible thing the compiler is reasoning about.

E0502 is a shared and a mutable borrow overlapping. E0499 is two mutable borrows overlapping.
