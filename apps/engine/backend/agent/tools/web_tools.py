"""Web discovery tools stub."""

class WebTools:
    async def search_web(self, query: str, max_results: int = 5) -> dict:
        return {"query": query, "results": []}

    async def fetch_article(self, url: str) -> dict:
        return {"url": url, "content": ""}
