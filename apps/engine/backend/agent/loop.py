"""ReAct execution loop for the NEXUS agent brain."""

from agent.tools.window_tools import WindowTools
from agent.memory.buffer import ShortTermMemory
from agent.providers.ollama import OllamaProvider


class ReActLoop:
    def __init__(self) -> None:
        self.tools = WindowTools()
        self.memory = ShortTermMemory()
        self.provider = OllamaProvider()

    async def get_desktop_state(self) -> dict:
        return await self.tools.enumerate_windows()

    async def run(self, intent: str) -> dict:
        context = await self.tools.enumerate_windows()
        plan = await self.provider.plan(intent, context)
        return {"intent": intent, "plan": plan, "context": context}
