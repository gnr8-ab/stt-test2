from __future__ import annotations
import os
import json
from typing import Optional
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Body, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import asyncio
import base64
import websockets
import contextlib
import logging
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ws-live")

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
async def ephemeral(req: EphemeralRequest | None = Body(default=None)):
    if req is None:
        req = EphemeralRequest()
    lang = req.language or LANGUAGE
    t_model = req.transcribe_model or TRANSCRIBE_MODEL
    r_model = req.realtime_model or REALTIME_MODEL
    return await _create_session_token(r_model, t_model, lang)

@app.get("/api/config")
async def config():
    return {"realtime_model": REALTIME_MODEL, "transcribe_model": TRANSCRIBE_MODEL, "language": LANGUAGE}

# --- WS pipeline för Live (ord-för-ord) ---
@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await ws.accept()
    if not OPENAI_API_KEY:
        await ws.send_json({"type": "error", "message": "OPENAI_API_KEY saknas"})
        await ws.close()
        return

    oai_url = f"wss://api.openai.com/v1/realtime?model={REALTIME_MODEL}"
    headers = [
        ("Authorization", f"Bearer {OPENAI_API_KEY}"),
        ("OpenAI-Beta", "realtime=v1"),
    ]

    try:
        async with websockets.connect(
            oai_url,
            additional_headers=headers,
            ping_interval=20,
            ping_timeout=20,
            max_size=8_000_000,
        ) as oai:
            # --- Initiera sessionen ---
            session_update = {
                "type": "session.update",
                "session": {
                    "input_audio_format": "pcm16",  # 24 kHz mono
                    "input_audio_transcription": {
                        "model": TRANSCRIBE_MODEL,
                        "language": LANGUAGE,
                    },
                    # Använd server_vad men vi skapar responses själva
                    "turn_detection": {
                        "type": "server_vad",
                        "silence_duration_ms": 300,    # lite kortare för snabbare deltas
                        "prefix_padding_ms": 150,
                        "threshold": 0.5,
                        "create_response": False,
                    },
                },
            }
            await oai.send(json.dumps(session_update))
            await ws.send_json({
                "type": "log",
                "where": "server",
                "msg": "session.update sent (pcm16/24kHz, server_vad, create_response=False)"
            })

            response_state = {"inflight": False}

            async def pump_client_to_oai():
                """
                Commit + response.create när vi har >= 200 ms audio och ingen response är pågående.
                """
                MIN_MS = 200
                accum_bytes = 0
                commits = 0

                def b64len_to_bytes(n: int) -> int:
                    return (n * 3) // 4  # approx: 4 tecken base64 ≈ 3 bytes

                def bytes_to_ms(nbytes: int) -> float:
                    samples = nbytes / 2.0  # 16-bit -> 2 bytes/sample
                    return (samples / 24000.0) * 1000.0

                while True:
                    msg = await ws.receive_text()
                    data = json.loads(msg)
                    t = data.get("type")

                    if t == "chunk":
                        b64 = data["data"]
                        accum_bytes += b64len_to_bytes(len(b64))
                        await oai.send(json.dumps({
                            "type": "input_audio_buffer.append",
                            "audio": b64
                        }))

                        if (not response_state["inflight"]) and bytes_to_ms(accum_bytes) >= MIN_MS:
                            commits += 1
                            await oai.send(json.dumps({"type": "input_audio_buffer.commit"}))
                            await oai.send(json.dumps({
                                "type": "response.create",
                                "response": {
                                    "modalities": ["text"],
                                    "instructions": "Transcribe the latest audio in Swedish only."
                                }
                            }))
                            response_state["inflight"] = True
                            await ws.send_json({
                                "type": "log",
                                "where": "server",
                                "msg": f"commit #{commits}, ~{bytes_to_ms(accum_bytes):.0f}ms audio"
                            })
                            accum_bytes = 0

                    elif t == "flush":
                        if accum_bytes > 0 and not response_state["inflight"]:
                            await oai.send(json.dumps({"type": "input_audio_buffer.commit"}))
                            await oai.send(json.dumps({
                                "type": "response.create",
                                "response": {
                                    "modalities": ["text"],
                                    "instructions": "Transcribe the latest audio in Swedish only."
                                }
                            }))
                            response_state["inflight"] = True
                            await ws.send_json({
                                "type": "log",
                                "where": "server",
                                "msg": "flush -> commit + response.create"
                            })
                            accum_bytes = 0

                    elif t == "close":
                        break

            async def pump_oai_to_client():
                """
                Vidarebefordra *rinnande* textdeltas. Frigör inflight-flaggan på response.completed.
                """
                async for raw in oai:
                    try:
                        ev = json.loads(raw)
                    except Exception as ex:
                        await ws.send_json({
                            "type": "log",
                            "where": "server",
                            "msg": f"json parse error: {ex}"
                        })
                        continue

                    et = ev.get("type") or ""

                    # Streamade deltas (nya event)
                    if et == "response.output_text.delta":
                        delta = ev.get("delta") or ""
                        if delta:
                            await ws.send_json({"type": "delta", "text": delta})
                        continue

                    if et == "response.output_text.done":
                        text = ev.get("text") or ""
                        await ws.send_json({"type": "done", "text": text})
                        continue

                    # ASR-fallback
                    if et in (
                        "conversation.item.input_audio_transcription.delta",
                        "transcript.text.delta",
                        "input_audio_transcription.delta",
                    ):
                        delta = ev.get("delta") or ev.get("text") or ev.get("transcript") or ""
                        if delta:
                            await ws.send_json({"type": "delta", "text": delta})
                        continue

                    if et in (
                        "conversation.item.input_audio_transcription.completed",
                        "transcript.text.done",
                        "input_audio_transcription.completed",
                    ):
                        text = ev.get("transcript") or ev.get("text") or ""
                        await ws.send_json({"type": "done", "text": text})
                        continue

                    if et == "response.completed":
                        response_state["inflight"] = False
                        await ws.send_json({
                            "type": "log",
                            "where": "server",
                            "msg": "response.completed"
                        })
                        continue

                    if et == "error":
                        await ws.send_json({
                            "type": "error",
                            "message": ev.get("error", {}).get("message", str(ev))
                        })
                        continue

            await asyncio.gather(pump_client_to_oai(), pump_oai_to_client())

    except WebSocketDisconnect:
        return
    except Exception as e:
        try:
            await ws.send_json({"type": "error", "message": str(e)})
        finally:
            with contextlib.suppress(Exception):
                await ws.close()

