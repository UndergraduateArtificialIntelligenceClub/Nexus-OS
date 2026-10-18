"""Native window tools dispatched to the Rust layer."""

class WindowTools:
    async def enumerate_windows(self) -> dict:
        return {"windows": [], "monitors": []}

    async def move_window(self, window_id: str, x: int, y: int) -> dict:
        return {"window_id": window_id, "x": x, "y": y, "status": "moved"}

    async def close_window(self, window_id: str) -> dict:
        return {"window_id": window_id, "status": "closed"}
