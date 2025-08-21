import { useCallback, useRef, useState } from 'react'

function floatTo16BitPCM(float32: Float32Array): Int16Array {
    const out = new Int16Array(float32.length)
    for (let i = 0; i < float32.length; i++) {
        let s = Math.max(-1, Math.min(1, float32[i]))
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    return out
}

function downsampleTo24k(src: Float32Array, inputRate: number): Int16Array {
    const TARGET = 24000
    if (inputRate === TARGET) return floatTo16BitPCM(src)
    const ratio = inputRate / TARGET
    const newLen = Math.floor(src.length / ratio)
    const out = new Float32Array(newLen)
    for (let i = 0; i < newLen; i++) {
        const start = Math.floor(i * ratio)
        const end = Math.floor((i + 1) * ratio)
        let sum = 0, count = 0
        for (let j = start; j < end && j < src.length; j++) { sum += src[j]; count++ }
        out[i] = count ? sum / count : 0
    }
    return floatTo16BitPCM(out)
}

function concatFloat32(chunks: Float32Array[], totalSamples: number): Float32Array {
    const out = new Float32Array(totalSamples)
    let offset = 0
    for (const c of chunks) {
        out.set(c, offset)
        offset += c.length
    }
    return out
}

export function useLiveTranscribeWS() {
    const wsRef = useRef<WebSocket | null>(null)
    const [isRunning, setRunning] = useState(false)
    const [liveText, setLiveText] = useState('')

    const audioCtxRef = useRef<AudioContext | null>(null)
    const inputRateRef = useRef<number>(48000)

    // Batching-accumulator (före resampling)
    const f32ChunksRef = useRef<Float32Array[]>([])
    const f32SamplesRef = useRef<number>(0)

    const start = useCallback(async () => {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        const host = location.hostname
        const wsURL = `${proto}://${host}:8000/ws/live`
        const ws = new WebSocket(wsURL)
        wsRef.current = ws

        ws.onopen = async () => {
            try {
                const mic = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
                })
                const ctx = new AudioContext({ sampleRate: 48000 })
                audioCtxRef.current = ctx
                await ctx.audioWorklet.addModule('/pcm-worklet.js')

                const src = ctx.createMediaStreamSource(mic)
                const node = new AudioWorkletNode(ctx, 'pcm-worklet')

                node.port.onmessage = (e: MessageEvent) => {
                    if (e.data?.type === 'ready') {
                        inputRateRef.current = e.data.sampleRate || ctx.sampleRate
                    } else if (e.data?.type === 'chunk') {
                        const f32: Float32Array = e.data.data
                        // Lägg till i vår batch-accumulator
                        f32ChunksRef.current.push(f32)
                        f32SamplesRef.current += f32.length

                        // Skicka ungefär var ~40ms (48000 * 0.04 = 1920 samples)
                        const THRESH_SAMPLES = Math.floor(inputRateRef.current * 0.04)
                        if (f32SamplesRef.current >= THRESH_SAMPLES) {
                            const joined = concatFloat32(f32ChunksRef.current, f32SamplesRef.current)
                            f32ChunksRef.current = []
                            f32SamplesRef.current = 0

                            const pcm16 = downsampleTo24k(joined, inputRateRef.current)
                            const b = new Blob([pcm16.buffer], { type: 'application/octet-stream' })
                            const reader = new FileReader()
                            reader.onload = () => {
                                const bytes = new Uint8Array(reader.result as ArrayBuffer)
                                let binary = ''
                                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
                                const b64 = btoa(binary)
                                ws.send(JSON.stringify({ type: 'chunk', data: b64 }))
                            }
                            reader.readAsArrayBuffer(b)
                        }
                    }
                }

                src.connect(node)
                // Vill du slippa eko? kommentera nästa rad:
                node.connect(ctx.destination)

                setRunning(true)
            } catch (err) {
                console.error("[AUDIO] error", err)
            }
        }

        ws.onmessage = (ev) => {
            try {
                const data = JSON.parse(ev.data)
                if (data.type === 'delta') {
                    setLiveText(prev => prev + data.text)
                } else if (data.type === 'done') {
                    setLiveText(prev => prev + (prev && !prev.endsWith(' ') ? ' ' : ''))
                } else if (data.type === 'log') {
                    console.log(`[SERVER] ${data.msg}`)
                } else if (data.type === 'error') {
                    console.error("[SERVER ERROR]", data.message)
                }
            } catch (e) {
                console.warn("[WS message parse error]", e)
            }
        }

        ws.onclose = (ev) => {
            setRunning(false)
        }

        ws.onerror = (ev) => {
            console.error("[WS] error", ev)
        }
    }, [])

    const stop = useCallback(() => {
        setRunning(false)
        try { wsRef.current?.send(JSON.stringify({ type: 'flush' })) } catch {}
        try { wsRef.current?.send(JSON.stringify({ type: 'close' })) } catch {}
        try { wsRef.current?.close() } catch {}
        try { audioCtxRef.current?.close() } catch {}
        // töm batch
        f32ChunksRef.current = []
        f32SamplesRef.current = 0
    }, [])

    const reset = useCallback(() => setLiveText(''), [])

    return { isRunning, liveText, start, stop, reset }
}
