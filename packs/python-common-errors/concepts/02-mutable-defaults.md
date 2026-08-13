+++
id = "functions.mutable-defaults"
title = "Default arguments are evaluated once"
patterns = [
  "dangerous default value .+ as argument",
  "do not use mutable data structures for argument defaults",
]
socraticTemplates = [
  "The default list is written inside the `def` line. When does Python actually evaluate that line — every call, or once?",
  "If two separate calls both use the default, how many list objects exist — and what would prove it?",
  "What would you have to change so that each call gets its own fresh container?",
]
checkForUnderstanding = "You can predict the output of a function with a `[]` default called three times in a row, and explain why it is not `[1]` each time."
+++

A `def` statement is executed once, when the module is loaded. Everything in the signature — the
default values included — is evaluated at that moment, and the resulting objects are attached to the
function. They are not re-created per call.

So `def add(item, bucket=[])` creates exactly one list, ever. Every call that does not pass a bucket
gets that same list, still holding whatever the last call put in it. The function appears to
remember things between calls, which is not a bug in Python so much as the natural consequence of a
rule that is genuinely useful elsewhere: it is the same rule that lets you write
`def f(x, cache={})` deliberately, or bind a loop variable with `lambda i=i: ...`.

You can watch it happen. `add.__defaults__` shows you the object, and it grows.

The fix is to make the default a sentinel and build the real value inside the body:

```python
def add(item, bucket=None):
    if bucket is None:
        bucket = []
```

`None` is the conventional sentinel because it is cheap to test with `is` and almost never a
legitimate value. When it *is* a legitimate value — a caller might genuinely mean "no timeout" — the
usual move is a module-level `_MISSING = object()` instead, which nothing outside your module can
produce by accident.

Immutable defaults — numbers, strings, tuples, `None`, `frozenset()` — are safe for the same reason
the mutable ones are not: sharing one object between calls only matters if somebody can change it.
