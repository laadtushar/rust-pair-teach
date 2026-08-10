+++
id = "borrowing"
title = "Lending things out"
goal = "You have hit a borrow conflict and fixed it by moving one line."
concepts = ["rust/borrows.conflicting"]

[[steps]]
instruction = "In `main`, make a mutable vector: `let mut numbers = vec![1, 2, 3];`"
check = { kind = "file_contains", path = "src/main.rs", pattern = "let\\s+mut\\s+\\w+\\s*=\\s*vec!\\[" }

[[steps]]
instruction = "Take a reference to its first element: `let first = &numbers[0];`"
check = { kind = "file_contains", path = "src/main.rs", pattern = "=\\s*&\\w+\\[0\\]" }

[[steps]]
instruction = "Now push to the vector, and *after that* print `first`. Run `cargo run`."
hint = "You are aiming for E0502. The order of those two lines is the entire lesson."
check = { kind = "command_run", command = "cargo run" }

[[steps]]
instruction = "Fix it without deleting anything: move the `println!` that uses `first` to *before* the push."
hint = "A borrow lasts until its last use, not until the end of the block. Finish with it, and the conflict disappears."
check = { kind = "command_run", command = "cargo run" }
+++

Rust's second rule: at any moment you may have **either** any number of shared references (`&T`),
**or** exactly one mutable reference (`&mut T`). Never both.

This is not bureaucracy. Pushing to a `Vec` may reallocate its buffer, and any reference into the old
buffer would then point at freed memory. A shared reference held across a `push` is a use-after-free
waiting to happen, and the rule turns that whole class of bug into a compile error. The same rule is
what makes data races impossible in safe Rust.

The part that trips everyone up is **when a borrow ends**. It ends at its *last use*, not at the end
of the block. So this is fine:

```
let first = &numbers[0];
println!("{first}");   // last use — borrow ends here
numbers.push(4);       // fine
```

and swapping those last two lines is an error. Identical code, different order, different answer.

When a borrow error surprises you, the question is almost never "why is this rule so strict". It is
"where is the last use of the first borrow?"
