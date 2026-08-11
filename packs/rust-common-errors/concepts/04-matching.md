+++
id = "matching.exhaustive"
title = "Covering every case"
codes = ["E0004", "E0005"]
socraticTemplates = [
  "Which case have you not written a branch for — and what should happen in it?",
  "If that variant did occur at runtime, what would you want the program to do?",
  "Is there a case here you are assuming cannot happen? What guarantees that?",
]
checkForUnderstanding = "You can list every variant of the type you are matching and say what your code does for each."
+++

`match` must cover every possibility. If you miss one, the code does not compile.

This is one of Rust's quietest and most valuable features. In most languages a forgotten case is a
runtime surprise, often months later, often in front of a user. Here it is a compile error before
you have finished writing the function.

E0004 lists exactly which patterns are unhandled. Read that list — it is a free specification of
the cases you had not thought about.

You can always add `_ => ...` to catch the rest, and sometimes that is right. But reach for it
knowingly: a wildcard also means that when someone adds a new variant later, your code silently
keeps compiling while doing the wrong thing for it. Listing variants explicitly turns that future
change into a compile error, which is usually what you want.

E0005 is the same idea in a `let`: you cannot destructure with a pattern that might not match,
because there would be nowhere for the failure to go.
