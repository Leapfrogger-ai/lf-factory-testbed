# To-do List

A tiny in-memory to-do list library, the practice app that LF Factory builds stories against.

## Language

**Remove**:
Deleting a to-do from the list outright, so it no longer appears anywhere. Unlike **complete**, it records nothing about the to-do.
_Avoid_: Delete, discard, archive

**Complete**:
Marking a to-do as done. It stays in the list but no longer appears in `pending()`.
_Avoid_: Finish, close, check off

**Pending**:
A to-do that is not yet complete.
_Avoid_: Open, outstanding, todo (as a state)
