+++
id = "types.none-propagation"
title = "Where the None came from"
patterns = [
  "'NoneType' object has no attribute",
  "'NoneType' object is not (subscriptable|iterable|callable)",
  "object of type 'NoneType' has no len",
  "argument of type 'NoneType' is not iterable",
]
socraticTemplates = [
  "The line that failed is where the None was *used*. Which line do you think produced it?",
  "Every function that does not hit a `return` returns None. Is there a path through the function you called that reaches the end without returning?",
  "What is the difference between `lst.sort()` and `sorted(lst)`, and which one did you assign?",
]
checkForUnderstanding = "When you see this error you look upstream for the line that produced the None, rather than adding a check at the line that crashed."
+++

This error is almost never about the line it points at. `None` has no attributes, so the moment you
touch one you get a traceback — but `None` was produced somewhere earlier and carried along quietly
until something asked it to do work. The useful question is not "how do I stop this line failing"
but "which line produced a None, and did I expect it to?"

There are four common sources, and it is worth learning to recognise them by shape.

A function that falls off the end. Python returns `None` from any function that finishes without
hitting a `return`, so a missing `return` in one branch of an `if` is invisible until a caller uses
the result.

A method that mutates in place. `list.sort()`, `list.append()`, `dict.update()`, `random.shuffle()`
all return `None` by design, because they changed the object rather than producing a new one.
`x = my_list.sort()` is the classic: the list *is* sorted, and `x` is `None`. When you want a new
value, `sorted(my_list)` is the version that returns one.

A lookup that found nothing. `dict.get(k)`, `re.match(...)`, `next(it, None)`, and most ORM
`get_or_none` helpers all return `None` for "not there". This is the one case where the `None` is
genuinely expected, and the right response is to handle it at that line, not further downstream.

An uninitialised attribute. `self.conn = None` in `__init__`, set for real in some `connect()` that
this code path never called.

The instinct to add `if x is not None:` at the crash site is understandable and usually wrong: it
converts a loud failure into a silent one. Fix it where the `None` was made, or handle it at the
lookup that legitimately returned it.
