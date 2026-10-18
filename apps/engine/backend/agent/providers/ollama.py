"""Ollama (local) LLM provider adapter."""

class OllamaProvider:
    async def plan(self, intent: str, context: dict) -> dict:
        return {"intent": intent, "steps": [], "provider": "ollama"}
