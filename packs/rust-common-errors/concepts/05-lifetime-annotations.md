+++
id = "lifetimes.annotations"
title = "When the compiler asks you to name a lifetime"
codes = ["E0106", "E0621"]
socraticTemplates = [
  "This returns a reference — which of the inputs is it borrowed from?",
  "If the compiler had to guess where this reference came from, what are the candidates?",
  "Does this really need to return a reference, or would an owned value be simpler here?",
]
checkForUnderstanding = "You can point at the input a returned reference borrows from, and explain why the compiler could not work it out alone."
+++

E0106 — missing lifetime specifier — means you returned a reference and the compiler cannot tell
what it borrows from.

Most of the time it works this out alone. With one reference parameter, the answer is obvious: the
output borrows from that input. With two, it genuinely cannot know which, and it asks you rather
than guessing. That is all `<'a>` is: a label saying "this output borrows from that input".

Lifetime annotations never change how long anything lives. They describe a relationship that
already exists. Adding `<'a>` cannot make a value survive longer, and expecting it to is the most
common misunderstanding here.

Before reaching for annotations, ask whether the function should return an owned value instead.
Beginners add lifetimes where experienced Rust programmers restructure ownership, and returning a
`String` rather than a `&str` is very often both simpler and fast enough. Save the annotations for
when borrowing genuinely is the right design — usually a struct that holds a reference into
something with a longer life.
