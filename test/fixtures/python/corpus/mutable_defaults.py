"""Default arguments are evaluated once."""


def collect(item, bucket=[]):
    """The list is created once, at def time."""
    bucket.append(item)
    return bucket


def tally(key, seen={}):
    """Same trap with a dict."""
    seen[key] = True
    return seen
