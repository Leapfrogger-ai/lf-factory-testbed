"""An in-memory to-do list."""

from dataclasses import dataclass


@dataclass
class Todo:
    id: int
    title: str
    done: bool = False


class TodoList:
    def __init__(self) -> None:
        self._items: dict[int, Todo] = {}
        self._next_id = 1

    def add(self, title: str) -> Todo:
        title = title.strip()
        if not title:
            raise ValueError("title must not be empty")
        todo = Todo(id=self._next_id, title=title)
        self._items[todo.id] = todo
        self._next_id += 1
        return todo

    def complete(self, todo_id: int) -> Todo:
        todo = self._items[todo_id]
        todo.done = True
        return todo

    def pending(self) -> list[Todo]:
        return [t for t in self._items.values() if not t.done]
