"""Short-term memory buffer for agent context."""

class ShortTermMemory:
    def __init__(self) -> None:
        self.buffer: list[dict] = []

    def add(self, entry: dict) -> None:
        self.buffer.append(entry)

    def get(self) -> list[dict]:
        return self.buffer
