+++
id = "ownership"
title = "The thing that makes Rust Rust"
goal = "You have caused a move error on purpose, and fixed it two different ways."
concepts = ["rust/ownership.moves"]

[[steps]]
instruction = "In `main`, make an owned String: `let name = String::from(\"your name\");`"
check = { kind = "file_contains", path = "src/main.rs", pattern = "String::from\\(" }

[[steps]]
instruction = "Write a function `fn greet(who: String)` that prints a greeting using it."
check = { kind = "file_contains", path = "src/main.rs", pattern = "fn\\s+greet\\s*\\(\\s*\\w+\\s*:\\s*String" }

[[steps]]
instruction = "Call `greet(name);` and then, on the next line, try to print `name` again. Run `cargo run`."
hint = "You want the error E0382, 'borrow of moved value'. Read the whole message — the note about where the move happened is the important part."
check = { kind = "command_run", command = "cargo run" }

[[steps]]
instruction = "Fix it the good way: change `greet` to take `&String` (or better, `&str`), and pass `&name`."
hint = "Borrowing lends the value without giving it away. The caller keeps ownership."
check = { kind = "file_contains", path = "src/main.rs", pattern = "fn\\s+greet\\s*\\(\\s*\\w+\\s*:\\s*&" }

[[steps]]
instruction = "Run it again and confirm both lines print."
check = { kind = "command_run", command = "cargo run" }
+++

This is the lesson everything else rests on, so go slowly.

Every value in Rust has exactly one **owner**. When the owner goes out of scope, the value is freed.
That is the whole mechanism, and it is why Rust needs no garbage collector and no manual `free`.

Passing a `String` to a function by value **moves** it: ownership transfers, and the original name
becomes unusable. Not copied, not secretly shared — the old name is simply no longer responsible for
that memory, so it is not allowed to read it.

The reason is worth sitting with. If both names stayed valid, both would free the same memory at the
end of their scope. That is a double free, one of the classic sources of security bugs in C and C++.
Rust makes it unrepresentable rather than merely discouraged.

You will hit E0382 in this lesson on purpose. Everyone hits it. The instinct will be to reach for
`.clone()` to make the error go away — resist that for now. Borrowing with `&` is usually what you
actually meant: lend the value, do not hand it over.
