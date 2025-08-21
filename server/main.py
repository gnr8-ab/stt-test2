from __future__ import annotations
import os
from typing import Optional
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
REALTIME_MODEL = os.getenv("REALTIME_MODEL", "gpt-4o-mini-realtime-preview")
TRANSCRIBE_MODEL = os.getenv("TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
LANGUAGE = os.getenv("LANGUAGE", "sv")
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

app = FastAPI(title="Realtime STT (svenska) – FastAPI")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class EphemeralRequest(BaseModel):
    language: Optional[str] = Field(default=None)
    transcribe_model: Optional[str] = Field(default=None)
    realtime_model: Optional[str] = Field(default=None)

class EphemeralResponse(BaseModel):
    client_secret: str
    expires_at: Optional[int] = None
    model: str
    transcription_model: str
    language: str
    webrtc_url: str

@app.get("/api/health")
async def health():
    return {"ok": True}

async def _create_session_token(realtime_model: str, transcribe_model: str, language: str) -> EphemeralResponse:
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY är inte satt")
    url = "https://api.openai.com/v1/realtime/sessions"
    payload = {
        "model": realtime_model,
        "input_audio_transcription": {"model": transcribe_model, "language": language},
        "turn_detection": {
            "type": "server_vad",
            "silence_duration_ms": 200,
            "prefix_padding_ms": 300,
            "threshold": 0.5,
            "create_response": False,
        },
    }
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(url, json=payload, headers=headers)
        r.raise_for_status()
        data = r.json()
        client_secret = data["client_secret"]["value"]
        expires_at = data["client_secret"].get("expires_at")
    return EphemeralResponse(
        client_secret=client_secret,
        expires_at=expires_at,
        model=realtime_model,
        transcription_model=transcribe_model,
        language=language,
        webrtc_url="https://api.openai.com/v1/realtime",
    )

@app.post("/api/ephemeral", response_model=EphemeralResponse)
async def ephemeral(req: EphemeralRequest):
    lang = req.language or LANGUAGE
    t_model = req.transcribe_model or TRANSCRIBE_MODEL
    r_model = req.realtime_model or REALTIME_MODEL
    return await _create_session_token(r_model, t_model, lang)

@app.get("/api/config")
async def config():
    return {"realtime_model": REALTIME_MODEL, "transcribe_model": TRANSCRIBE_MODEL, "language": LANGUAGE}
