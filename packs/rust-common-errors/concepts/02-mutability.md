+++
id = "mutability.permission"
title = "Asking for permission to change things"
codes = ["E0596", "E0594", "E0507"]
socraticTemplates = [
  "You are trying to change something through this reference — was it lent to you as changeable?",
  "Where was this binding created, and did that line say `mut`?",
  "You are moving a value out of something you only borrowed — who still owns it afterwards?",
]
checkForUnderstanding = "You can trace back from the error to the exact line where the permission should have been granted."
+++

Three closely related complaints, all about permission.

**E0596 — cannot borrow as mutable.** You asked for `&mut` on something that is not `mut`. The fix
is nearly always at the *declaration*, not at the line the error points to: `let mut x`, or a
parameter typed `&mut T` rather than `&T`.

**E0594 — cannot assign to.** You tried to write through a shared reference. Same cause, same fix.

**E0507 — cannot move out of borrowed content.** Subtler, and the one that confuses people longest.
You borrowed something, then tried to take a value *out* of it — leaving a hole in something you do
not own. If the original owner later reads that field, it would be reading nothing.

The three usual ways out of E0507: borrow the inner value instead of taking it (`&thing.field`),
clone it if you genuinely need an independent copy, or take ownership of the whole container so
there is nothing to leave a hole in. For `Option`, `.take()` exists precisely for this — it swaps in
`None` so nothing is left dangling.
