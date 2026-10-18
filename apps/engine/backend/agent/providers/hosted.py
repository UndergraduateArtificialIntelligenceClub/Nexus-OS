"""Hosted LLM provider adapters (OpenAI / Anthropic)."""

class HostedProvider:
    async def plan(self, intent: str, context: dict) -> dict:
        return {"intent": intent, "steps": [], "provider": "hosted"}
