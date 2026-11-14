import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { ClientMsg, ServerMsg, State } from './protocol';

// Set this to the game server's WebSocket endpoint when starting Expo.
export const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || '';

type Snap = { connected: boolean; joining: boolean; state: State | null; seat: number; error: string | null };
let snap: Snap = { connected: false, joining: false, state: null, seat: 0, error: null };
const listeners = new Set<() => void>();
const set = (p: Partial<Snap>) => {
  snap = { ...snap, ...p };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const getSnap = () => snap;
export const useNet = () => useSyncExternalStore(subscribe, getSnap, getSnap); // 3rd arg: web server render

/** serverTime - localTime */
let offset = 0;
export const serverNow = () => Date.now() + offset;

type Bar = { tempo: number };
const barListeners = new Set<(b: Bar) => void>();
export const onBar = (f: (b: Bar) => void) => (barListeners.add(f), () => void barListeners.delete(f));

/** The server refused a note-editor part (error code bad_pattern). The previous part is still in state.notes. */
const rejectListeners = new Set<(message: string) => void>();
export const onPatternRejected = (f: (message: string) => void) => (rejectListeners.add(f), () => void rejectListeners.delete(f));

let ws: WebSocket | null = null;
let join: { name: string; room: string; token?: string } | null = null; // room '' = host

/** No room = host a new one. */
export function connect(name: string, room = '') {
  if (!SERVER_URL) return set({ error: 'The game server is not configured yet.', joining: false });
  const previous = ws;
  ws = null;
  previous?.close();
  join = { name, room: room.trim().toUpperCase() };
  set({ error: null, joining: true, state: null, seat: 0, connected: false });
  open();
}

function open() {
  let sock: WebSocket;
  try {
    sock = new WebSocket(SERVER_URL);
  } catch {
    join = null;
    set({ error: 'The game server address is invalid.', joining: false });
    return;
  }
  let welcomed = false;
  ws = sock;
  sock.onopen = () => {
    if (ws !== sock) return;
    set({ connected: true });
    if (join) send({ type: 'join', role: 'player', name: join.name, ...(join.token && { token: join.token }), ...(join.room && { room: join.room }) });
  };
  sock.onmessage = (e) => {
    if (ws !== sock) return;
    const m: ServerMsg = JSON.parse(String(e.data));
    if (m.type === 'state') {
      offset = m.serverTime - Date.now();
      set({ state: m, joining: false });
    } else if (m.type === 'welcome') {
      welcomed = true;
      if (join) {
        join.room = m.room ?? join.room;
        join.token = m.token;
      }
      set({ seat: m.seat, error: null });
    }
    else if (m.type === 'bar') barListeners.forEach((f) => f({ tempo: m.tempo }));
    else if (m.type === 'kicked') {
      join = null; // don't auto-rejoin
      sock.close();
      set({ connected: false, state: null, seat: 0, joining: false, error: 'You were removed from the room' });
    } else if (m.type === 'error') {
      if (!welcomed) {
        join = null;
        set({ state: null, seat: 0 });
        sock.close();
      }
      set({ error: m.message, joining: false });
      if (m.code === 'bad_pattern') rejectListeners.forEach((f) => f(m.message));
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    set({ connected: false });
    if (!join) return; // intentional leave, removal, or a rejected join: keep its message
    if (!snap.state && !join.token) {
      // Never got into a room: say so instead of retrying silently.
      join = null;
      return set({ joining: false, error: `Can't reach the server at ${SERVER_URL}` });
    }
    if (join) setTimeout(() => join && !ws && open(), 1000);
  };
}

// A locked phone's socket is often dead without a close event yet: reconnect as soon as the app is back.
// Only after 'background': 'inactive' (Control Center, notifications) keeps the socket alive.
let away = false;
AppState.addEventListener('change', (st) => {
  if (st === 'background') away = true;
  if (st !== 'active' || !away) return;
  away = false;
  if (!join?.token) return;
  // Don't close the old socket: the server would count that as leaving (ending compose early).
  // The token rejoin replaces it on the server, and its handlers go quiet once ws moves on.
  ws = null;
  set({ connected: false }); // sends are dropped until the new socket opens
  open();
});

export function leave() {
  send({ type: 'leave' });
  join = null;
  ws?.close();
  set({ state: null, seat: 0, error: null, joining: false });
}

export const clearError = () => set({ error: null });

export function send(m: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

/** Whole seconds left until a server deadline, re-rendering as it ticks. */
export function useSecondsLeft(deadline: number) {
  const calc = () => (deadline ? Math.max(0, Math.ceil((deadline - serverNow()) / 1000)) : 0);
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setLeft(calc()), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);
  return left;
}

/** Increments on every beat, driven by the TV's `bar` messages (4 beats per bar). */
export function useBeat() {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    const off = onBar(({ tempo }) => {
      timers.forEach(clearTimeout);
      const ms = 60000 / tempo;
      timers = [0, 1, 2, 3].map((k) => setTimeout(() => setBeat((b) => b + 1), k * ms));
    });
    return () => {
      off();
      timers.forEach(clearTimeout);
    };
  }, []);
  return beat;
}
