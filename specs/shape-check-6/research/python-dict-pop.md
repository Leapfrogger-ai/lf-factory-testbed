# Python `dict.pop` without a default

**Version**: Python 3.12
**Date**: 2026-10-20

## Question

In Python 3.12, what does `dict.pop(key)` do when called with no default? Does it remove the key and return its value, and does it raise `KeyError` when the key is absent? Does `del d[key]` raise `KeyError` on a missing key, and does dict preserve insertion order (relevant to a list method that iterates `self._items.values()` after an entry has been removed)?

## Answer

Yes: in Python 3.12, `d.pop(key)` with no default removes `key` and returns its value, raising `KeyError` if the key is absent, `del d[key]` also raises `KeyError` on a missing key, and dicts preserve insertion order, so deleting an entry leaves the order of the others unchanged.

## Native feature

`pop(key[, default])`, a method of `dict`.

## What it replaces

Hand-rolled logic in a `remove()` method that checks membership, raises `KeyError` itself, deletes the entry, then returns the value:

```python
# before
if key not in self._items:
    raise KeyError(key)
item = self._items[key]
del self._items[key]
return item

# after
return self._items.pop(key)
```

Because order is preserved, `self._items.values()` still yields the remaining entries in the order they were inserted after a `pop`.

## Limits at this version

- Passing a default suppresses `KeyError`: `pop(key, default)` returns `default` for a missing key. Call `pop(key)` with one argument when the caller needs `KeyError`.
- A key re-added after deletion goes to the end, not back to its old position.
- `values()` returns a view, not a copy. The docs reference the view-objects section for its behavior; don't change the dict while iterating it.

## Sources

| Claim | URL | Exact quote |
|---|---|---|
| `pop` removes and returns, else default | https://docs.python.org/3.12/library/stdtypes.html#dict.pop | "If *key* is in the dictionary, remove it and return its value, else return *default*." |
| `pop` without default raises `KeyError` | https://docs.python.org/3.12/library/stdtypes.html#dict.pop | "If *default* is not given and *key* is not in the dictionary, a KeyError is raised." |
| `del d[key]` raises `KeyError` | https://docs.python.org/3.12/library/stdtypes.html#mapping-types-dict | "Remove `d[key]` from *d*. Raises a KeyError if *key* is not in the map." |
| Insertion order preserved | https://docs.python.org/3.12/library/stdtypes.html#mapping-types-dict | "Dictionaries preserve insertion order. Note that updating a key does not affect the order. Keys added after deletion are inserted at the end." |
| Guaranteed since 3.7 | https://docs.python.org/3.12/library/stdtypes.html#mapping-types-dict | "Changed in version 3.7: Dictionary order is guaranteed to be insertion order." |
| `values()` is a view | https://docs.python.org/3.12/library/stdtypes.html#dict.values | "Return a new view of the dictionary's values." |
