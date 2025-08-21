import { useCallback, useRef, useState } from 'react'
import type { EphemeralResponse } from '../types'

export function useRealtimeTranscription() {
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const [isRunning, setRunning] = useState(false)
  const [unstableText, setUnstableText] = useState('')
  const [stableText, setStableText] = useState('')

  const reset = useCallback(() => {
    setUnstableText('')
    setStableText('')
  }, [])

  const stop = useCallback(() => {
    setRunning(false)
    try { dcRef.current?.close() } catch {}
    try { pcRef.current?.close() } catch {}
    micStreamRef.current?.getTracks().forEach(t => t.stop())
    pcRef.current = null
    dcRef.current = null
    micStreamRef.current = null
  }, [])

  const onServerEvent = useCallback((raw: MessageEvent) => {
    try {
      const ev = JSON.parse(raw.data)
      switch (ev.type) {
        case 'conversation.item.input_audio_transcription.delta': {
          const delta: string = ev.delta ?? ev.text ?? ev.transcript ?? ''
          if (delta) setUnstableText(prev => prev + delta)
          break
        }
        case 'conversation.item.input_audio_transcription.completed': {
          const text: string = ev.transcript ?? ev.text ?? unstableText
          setStableText(prev => (prev + (prev ? '\n' : '') + text).trim())
          setUnstableText('')
          break
        }
        default:
          break
      }
    } catch {}
  }, [unstableText])

  const start = useCallback(async () => {
    reset()
    const res = await fetch('/api/ephemeral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'sv' })
    })
    if (!res.ok) throw new Error('Kunde inte hämta ephemeral token')
    const eph: EphemeralResponse = await res.json()

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302'] }],
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle'
    })
    pcRef.current = pc
    pc.addEventListener('iceconnectionstatechange', () => console.log('ICE:', pc.iceConnectionState))

    const dc = pc.createDataChannel('oai-events')
    dcRef.current = dc
    dc.addEventListener('open', () => {
      const msg = {
        type: 'session.update',
        session: {
          input_audio_transcription: { model: eph.transcription_model, language: eph.language },
          turn_detection: {
            type: 'server_vad',
            silence_duration_ms: 200,
            prefix_padding_ms: 300,
            threshold: 0.5,
            create_response: false
          }
        }
      }
      dc.send(JSON.stringify(msg))
    })
    dc.addEventListener('message', onServerEvent)

    const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
    micStreamRef.current = media
    pc.addTrack(media.getAudioTracks()[0], media)

    const audioEl = document.createElement('audio')
    audioEl.autoplay = true
    pc.ontrack = (e) => { audioEl.srcObject = e.streams[0] }
    document.body.appendChild(audioEl)

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    const sdpResponse = await fetch(`${eph.webrtc_url}?model=${encodeURIComponent(eph.model)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${eph.client_secret}`, 'Content-Type': 'application/sdp' },
      body: offer.sdp!
    })
    const answer = await sdpResponse.text()
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })
    setRunning(true)
  }, [onServerEvent, reset])

  return { isRunning, unstableText, stableText, start, stop }
}
