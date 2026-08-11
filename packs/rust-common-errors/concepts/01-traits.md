+++
id = "traits.bounds"
title = "Traits and what a type can do"
codes = ["E0277", "E0599"]
socraticTemplates = [
  "The compiler says this type does not do that — where would it have learned how?",
  "Which trait provides the method you are calling, and is it in scope here?",
  "If you wrote this function for one concrete type first, what would its signature be?",
]
checkForUnderstanding = "You can name the trait a method comes from, and say why the compiler could not find it."
+++

A trait is a set of capabilities a type can have — `Display` means it can be printed for humans,
`Clone` means it can be duplicated, `Iterator` means it can produce values one at a time.

E0277 says a type does not implement a trait something needs. Read it as two halves: which trait,
and which type is missing it. The fix is either to implement the trait, to use a type that already
does, or — often — to realise you meant a different method.

E0599 says a method does not exist on this type. In Rust that usually means one of three things.
The method comes from a trait that is not in scope, and you need a `use`. Or you are holding a
reference where the method wants ownership, or the reverse. Or the method genuinely belongs to a
different type and you have one layer of wrapping too many — `Option<Vec<T>>` is not a `Vec<T>`.

The habit worth building: when the compiler says a method is missing, check the *type* it is
complaining about rather than the method name. Nine times in ten the type is not what you assumed.
