+++
id = "scope.late-binding"
title = "Closures capture names, not values"
codes = [
  "W0640", "cell-var-from-loop",
  "W0631", "undefined-loop-variable",
  "B023",
  "reportPossiblyUnboundVariable",
]
patterns = [
  "cell variable .+ defined in loop",
  "function definition does not bind loop variable",
  "using possibly undefined loop variable",
]
socraticTemplates = [
  "Each function you made in that loop refers to the loop variable. Does it store the value it had at the time, or the variable itself?",
  "By the time you call the first function, what is the loop variable's value?",
  "What is the difference between a function that *looks up* `i` when called and one that *remembers* `i` from when it was made?",
]
checkForUnderstanding = "You can predict what a list of lambdas built in a `for i in range(3)` loop prints when called afterwards, and say why."
+++

A closure captures the *variable*, not a snapshot of what it held. When the function body finally
runs, it looks the name up in the enclosing scope as that scope is *now* — which, for a loop
variable, is whatever the loop left behind.

So building three functions in `for i in range(3)` and calling them afterwards gives you `2, 2, 2`.
Nothing was overwritten; all three functions were always asking the same question, and they only
asked it after the loop had finished answering.

This is not a Python wart so much as the price of a genuinely useful feature: a closure that saw a
stale copy of its environment would break every counter, accumulator and callback that relies on
seeing changes. The behaviour is right; the loop case is the one place it surprises people.

Two fixes, and they are different tools rather than alternatives.

Bind at definition time with a default argument: `lambda x, i=i: ...`. Defaults are evaluated when
the `def`/`lambda` is executed, so each function gets its own value. This is the idiom you will see
most, and the small oddity of an extra parameter is the cost.

Make a new scope per iteration, with `functools.partial(handler, i)` or a factory function that
takes `i` and returns the closure. More machinery, clearer intent, and the version to prefer when
the captured value is part of the API rather than an implementation detail.

The same rule explains a second puzzle worth recognising: a `for` variable is still in scope after
the loop ends, because `for` does not create a scope. Only functions, classes, modules and
comprehensions do.
