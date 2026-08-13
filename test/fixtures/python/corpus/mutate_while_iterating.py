"""Changing a collection you are walking."""
import collections


def mutate_dict():
    """Dict raises at runtime; linters catch it statically."""
    d = {"a": 1, "b": 2}
    for k in d:
        d[k + "!"] = 1
    return d


def mutate_list():
    """List fails silently, which is worse."""
    xs = [1, 2, 3]
    for x in xs:
        xs.remove(x)
    return xs


def mutate_set():
    """Set raises like dict does."""
    s = {1, 2, 3}
    for x in s:
        s.add(x + 10)
    return s


def mutate_deque():
    """Deque raises too."""
    dq = collections.deque([1, 2])
    for x in dq:
        dq.append(x)
    return dq
