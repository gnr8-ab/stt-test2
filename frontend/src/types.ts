export type EphemeralResponse = {
  client_secret: string
  expires_at?: number
  model: string
  transcription_model: string
  language: string
  webrtc_url: string
}
