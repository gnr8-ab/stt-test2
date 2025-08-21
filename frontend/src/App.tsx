import React from 'react'
import { useRealtimeTranscription } from './hooks/useRealtimeTranscription'   // WebRTC -> Stabil
import { useLiveTranscribeWS } from './hooks/useLiveTranscribeWS'             // WS -> Live

export default function App() {
  const rt = useRealtimeTranscription()
  const ws = useLiveTranscribeWS()

  const running = rt.isRunning || ws.isRunning

  const onStart = async () => {
    ws.reset()
    await ws.start()
    await rt.start()
  }
  const onStop = () => {
    ws.stop()
    rt.stop()
  }

  return (
    <div style={{ maxWidth: 900, margin: '2rem auto', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' }}>
      <h1>🎙️ Live (WebSocket) + Stabil (WebRTC)</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        {!running ? (
          <button onClick={onStart} style={{ padding: '8px 14px' }}>Starta</button>
        ) : (
          <button onClick={onStop} style={{ padding: '8px 14px' }}>Stoppa</button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Live (WebSocket)</h3>
          <div style={{ minHeight: 140, whiteSpace: 'pre-wrap' }}>{ws.liveText || <em>—</em>}</div>
        </section>
        <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Stabil (WebRTC)</h3>
          <div style={{ minHeight: 140, whiteSpace: 'pre-wrap' }}>{rt.stableText || <em>—</em>}</div>
        </section>
      </div>
    </div>
  )
}
