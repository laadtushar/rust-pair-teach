+++
id = "collections"
title = "Vec and HashMap in anger"
goal = "A program that counts something using a HashMap."
concepts = ["rust/basics.types-and-mutability"]

[[steps]]
instruction = "Add `use std::collections::HashMap;` at the top of your file."
check = { kind = "file_contains", path = "src/main.rs", pattern = "use\\s+std::collections::HashMap" }

[[steps]]
instruction = "Count something into a HashMap — words in a sentence, letters in a name, anything with repeats."
hint = "The entry API is the idiomatic way: *counts.entry(word).or_insert(0) += 1"
check = { kind = "file_contains", path = "src/main.rs", pattern = "HashMap::new\\(\\)|entry\\(" }

[[steps]]
instruction = "Loop over the results and print each key with its count."
check = { kind = "file_contains", path = "src/main.rs", pattern = "for\\s+.*in\\s+&?\\w+" }

[[steps]]
instruction = "Run it. The order will look random — that is expected, and worth knowing now."
check = { kind = "command_run", command = "cargo run" }
+++

`Vec<T>` is a growable list. `HashMap<K, V>` maps keys to values. Between them they cover most of
what you will store.

The pattern worth learning properly is `entry`. Counting things naively means "look it up, if it is
missing insert zero, then add one" — three operations and two lookups. `entry` does it in one:

```
*counts.entry(word).or_insert(0) += 1;
```

Read it as: get me the slot for this key, putting 0 there if it is empty, and give me a mutable
reference to it. The `*` is because you are writing through that reference.

Two things that surprise people. `HashMap` iteration order is deliberately unspecified and varies
between runs — if you need order, sort the keys or use `BTreeMap`. And indexing a `Vec` out of
bounds panics, which is why `.get(i)` returning an `Option` exists and is usually the better choice.
