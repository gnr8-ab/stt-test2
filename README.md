# STT (svenska) – React + Vite + FastAPI

## Snabbstart
```bash
cp server/.env.example server/.env   # fyll i OPENAI_API_KEY
make setup
```
Kör tmux med backend + frontend. Frontend proxyar /api till backend.

## Notis
Denna baseline använder WebRTC till OpenAI Realtime. För ord-för-ord "live" kan vi lägga till en WebSocket-pipeline.
