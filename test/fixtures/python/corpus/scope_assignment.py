"""Assignment is what creates a local."""
TOTAL = 0
counter = 0


def reads_then_assigns():
    """Reads a name it also assigns, so the name is local throughout."""
    print(TOTAL)
    TOTAL = 1
    return TOTAL


def augmented_assign():
    """`+=` is a read followed by an assignment."""
    counter += 1
    return counter


def global_after_use():
    """Uses the name before declaring it global."""
    print(counter)
    global counter
    counter = 2
