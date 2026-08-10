+++
id = "lifetimes.dangling"
title = "Lifetimes and dangling references"
codes = ["E0597", "E0515", "E0716"]
socraticTemplates = [
  "The reference you are returning points into something — where does that something live, and when is it dropped?",
  "Which of these two values dies first, and what does the other one still hold when it does?",
  "If the compiler allowed this, what would the reference be pointing at one line after the function returns?",
]
checkForUnderstanding = "You can name the value being pointed at, say exactly where it is dropped, and explain why the reference would outlive it."
+++

A reference is a promise: "this memory is still valid." Lifetimes are how the compiler checks the
promise is kept. Every reference has a region of code over which it's valid, and the rule is simply
that a reference may never outlive the thing it points at.

Most lifetime errors are one of three shapes, and naming the shape is most of the fix.

**Returning a reference to a local (E0515).** The local is dropped when the function returns, so the
reference would point at freed stack memory before the caller could read it. The fix is usually to
return the owned value instead — if you built it in the function, the caller should own it.

**Value doesn't live long enough (E0597).** A reference outlives the value it borrows, typically
because the reference was stored somewhere longer-lived than the borrowed data. The fix is either to
extend the value's life (bind it earlier, in an outer scope) or shorten the reference's.

**Temporary dropped while borrowed (E0716).** The subtlest one. Temporaries created inside an
expression are dropped at the end of that statement, so a reference into a temporary dangles
immediately. `let r = &make_string();` is the classic — bind the value to a name first, and it lives
as long as the name does.

Two things worth internalizing. First, lifetimes never change how long a value lives; they only
*describe* it. Adding `<'a>` annotations doesn't extend anything — it tells the compiler about a
relationship that already exists. Second, when you find yourself trying to satisfy the compiler by
adding lifetime parameters, pause and ask whether the data should have been owned rather than
borrowed. Beginners reach for lifetime annotations where experienced Rust programmers restructure
ownership, and the restructure is usually both simpler and faster.
