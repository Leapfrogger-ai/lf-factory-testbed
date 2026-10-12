import pytest

from testbed import TodoList


def test_add_assigns_increasing_ids():
    todos = TodoList()
    assert todos.add("buy milk").id == 1
    assert todos.add("walk dog").id == 2


def test_add_rejects_blank_title():
    with pytest.raises(ValueError):
        TodoList().add("   ")


def test_complete_removes_from_pending():
    todos = TodoList()
    first = todos.add("buy milk")
    todos.add("walk dog")
    todos.complete(first.id)
    assert [t.title for t in todos.pending()] == ["walk dog"]


def test_complete_unknown_id_raises():
    with pytest.raises(KeyError):
        TodoList().complete(99)
