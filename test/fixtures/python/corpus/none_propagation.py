"""Where the None came from."""
from typing import Optional


def attribute_on_none():
    """The declared type is exactly None."""
    name = None
    return name.strip()


def length_of_none():
    """len() of None."""
    items = None
    return len(items)


def optional_member(value: Optional[str]):
    """Optional, unchecked."""
    return value.upper()


def optional_subscript(value: Optional[list]):
    """Optional, subscripted."""
    return value[0]


def optional_iterate(value: Optional[list]):
    """Optional, iterated."""
    return [x for x in value]


def optional_call(fn: Optional[object]):
    """Optional, called."""
    return fn()


def forgot_return(flag):
    """Falls off the end on one path, so callers get None."""
    if flag:
        return 1
    return None


def sort_returns_none():
    """The classic: sort() mutates and returns None."""
    xs = [3, 1, 2]
    ordered = xs.sort()
    return ordered.count(1)
