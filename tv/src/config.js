const params = new URLSearchParams(location.search)

export const MOCK = params.get('mock') === '1'

// Mock phase lengths are multiplied by this (e.g. ?speed=0.25 for a quick run).
export const MOCK_SPEED = Number(params.get('speed')) || 1

export const WS_URL =
  params.get('ws') || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

// Link encoded in the Lobby QR code (Expo Go). Set VITE_JOIN_URL at build time or ?join= at runtime.
export const JOIN_URL = params.get('join') || import.meta.env.VITE_JOIN_URL || 'exp://example/phone-orchestra'

export const SEAT_COLORS = ['#FF6B5A', '#FFB23E', '#A8E05F', '#2ED3B7', '#4DA8FF', '#A78BFA', '#FF7AC0', '#F1E6D2']

export const PHASES = ['lobby', 'compose', 'calibrate', 'perform', 'next_round', 'vote', 'results']
