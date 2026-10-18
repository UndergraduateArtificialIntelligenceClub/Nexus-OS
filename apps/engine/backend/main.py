"""NEXUS OS Agent Engine - FastAPI entry point."""

from fastapi import FastAPI
from agent.loop import ReActLoop

app = FastAPI(title="NEXUS OS Agent Brain", version="0.1.0")

react_loop = ReActLoop()


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "nexus-engine"}


@app.post("/desktop/state")
async def get_desktop_state() -> dict:
    return await react_loop.get_desktop_state()


@app.post("/agent/invoke")
async def agent_invoke(payload: dict) -> dict:
    intent = payload.get("intent", "")
    return await react_loop.run(intent)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
