import React, { useEffect, useState } from 'react'
import { useRealtimeTranscription } from './hooks/useRealtimeTranscription'

export default function App() {
  const { isRunning, unstableText, stableText, start, stop } = useRealtimeTranscription()
  const [config, setConfig] = useState<{realtime_model: string; transcribe_model: string; language: string} | null>(null)

  useEffect(() => { fetch('/api/config').then(r => r.json()).then(setConfig).catch(() => {}) }, [])

  return (
    <div style={{ maxWidth: 820, margin: '2rem auto', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' }}>
      <h1>🎙️ Live-transkribering (svenska)</h1>
      <p style={{ color: '#666' }}>
        Modeller: <code>{config?.realtime_model ?? '...'}</code> + <code>{config?.transcribe_model ?? '...'}</code> · Språk: <code>{config?.language ?? 'sv'}</code>
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        {!isRunning ? (
          <button onClick={start} style={{ padding: '8px 14px' }}>Starta</button>
        ) : (
          <button onClick={stop} style={{ padding: '8px 14px' }}>Stoppa</button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Instabil (live)</h3>
          <div style={{ minHeight: 120, whiteSpace: 'pre-wrap' }}>{unstableText || <em>—</em>}</div>
        </section>
        <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Stabil</h3>
          <div style={{ minHeight: 120, whiteSpace: 'pre-wrap' }}>{stableText || <em>—</em>}</div>
        </section>
      </div>
    </div>
  )
}
