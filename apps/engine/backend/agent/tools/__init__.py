"""Agent tool registry stub."""

from agent.tools.window_tools import WindowTools
from agent.tools.web_tools import WebTools


class ToolRegistry:
    def __init__(self) -> None:
        self.window = WindowTools()
        self.web = WebTools()
