"""SQLite session management stub."""

class SessionManager:
    def __init__(self, database_url: str = "sqlite:///./nexus_state.db") -> None:
        self.database_url = database_url
