+++
id = "scope.assignment"
title = "Assignment is what creates a local"
patterns = [
  "local variable '.+' referenced before assignment",
  "cannot access local variable '.+' where it is not associated with a value",
  "name '.+' is used prior to global declaration",
]
socraticTemplates = [
  "This name exists outside the function and you only read it — so why does Python think it is local?",
  "Somewhere in this function you assign to that name. What does Python decide about the whole function the moment it sees that assignment?",
  "If you deleted the assignment line entirely, would the error move, change, or disappear — and what does your answer tell you?",
]
checkForUnderstanding = "You can look at a function and say which names are local and which are not, without running it — by looking only for assignments."
+++

Python decides which names are local when it *compiles* the function, not while it runs it. The rule
is short: if a name is assigned anywhere in the function body, that name is local for the entire
function — including on lines above the assignment.

That is why this error feels like a paradox. You read a global on line 2, assign to it on line 5,
and Python complains about line 2. It is not confused about the order of execution. It decided,
before running a single line, that the name is local, and line 2 reads a local that has not been
given a value yet.

The word "assignment" is broader than it looks. `x = 1` is one, but so are `x += 1`, `for x in ...`,
`with open(f) as x`, `except E as x`, and `import x`. `x += 1` is the one that catches people most
often, because it looks like a modification of something that already exists — but it is a read
followed by an assignment, and the assignment is what makes the name local.

Two honest ways out, and one that is usually a mistake. Pass the value in as a parameter and return
the new one: that is the version you can test, and most of the time it is what you actually wanted.
Read from a container you mutate rather than rebind — `counters['total'] += 1` never makes anything
local, because you are not assigning to `counters`. And then there is `global`, which does silence
the error, and which quietly makes the function depend on state no caller can see. It is a real
tool, and it should be a decision rather than a reflex.

The version of this you will meet again is `nonlocal`, in a closure over an enclosing function's
variable. Same rule, one scope up.
