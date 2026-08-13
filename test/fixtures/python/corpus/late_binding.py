"""Closures capture names, not values."""


def build_lambdas():
    """Each lambda looks `i` up when called, not when made."""
    fns = []
    for i in range(3):
        fns.append(lambda: i)
    return fns


def build_closures():
    """Same with a def."""
    out = []
    for i in range(3):

        def inner():
            return i

        out.append(inner)
    return out


def loop_var_after_loop(items):
    """`for` creates no scope, so `j` outlives the loop - and may never be bound."""
    for j in items:
        if j:
            break
    return j
