+++
id = "collections.mutate-while-iterating"
title = "Changing a collection you are walking"
codes = [
  "E4702", "modified-iterating-dict",
  "E4703", "modified-iterating-set",
  "W4701", "modified-iterating-list",
]
patterns = [
  "iterated (dict|set|list) .+ is being modified inside for loop body",
]
socraticTemplates = [
  "The loop is holding a position in the collection. What happens to that position when the collection underneath it changes size?",
  "How many items does this loop visit if you remove one halfway through — and is that the number you wanted?",
  "What could you loop over instead, so that changing the original does not disturb the thing you are walking?",
]
checkForUnderstanding = "You can explain why removing from a list while looping over it silently skips items, while doing the same to a dict raises instead."
+++

A `for` loop does not take a copy. It asks the collection for an iterator, and that iterator holds a
position — an index, or a slot in a hash table. Change the collection's size and that position now
refers to something else.

Dicts and sets detect this and refuse: they keep a version counter and raise `RuntimeError` the
moment it moves under them. That is a kindness. Lists do not detect it, and the failure is far worse
for being silent — deleting the item at index `i` shifts everything down, the loop moves to `i + 1`,
and the element that slid into position `i` is never visited. Half your deletions quietly do not
happen, and nothing raises.

Three ways out, in the order worth reaching for them.

Build a new collection instead of editing the old one. `keep = [x for x in items if not stale(x)]`
says what you mean, is faster than repeated `remove`, and has no iteration hazard at all. This is
the answer most of the time.

Iterate over a snapshot when you really must edit in place: `for key in list(d):` walks a list of
the keys as they were, leaving `d` free to change. Note that `list(d)` is a real copy of the keys —
cheap for anything of ordinary size, and the explicitness is the point.

Collect first, act second. Gather the keys to remove in one pass, delete them in another. Slightly
longer, and the easiest version to read six months later.

The same hazard appears wherever something is walking a structure while something else edits it —
mutating a list inside a generator that reads it, or two threads on one dict. The version counter is
the specific mechanism; the general lesson is that iteration is a live view, not a photograph.
