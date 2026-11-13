import Constants from 'expo-constants';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { ClientMsg, ServerMsg, State } from './protocol';

// Dev default: the mock lobby on the Metro server that served this bundle (LAN or tunnel), see metro.config.js.
// Real game: EXPO_PUBLIC_SERVER_URL=wss://<Bryson's host>/ws.
const metroHost = Platform.OS === 'web' ? globalThis.location?.host : Constants.expoConfig?.hostUri;
const secure = Platform.OS === 'web' ? globalThis.location?.protocol === 'https:' : !!metroHost?.endsWith('.exp.direct');
export const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || `${secure ? 'wss' : 'ws'}://${metroHost || 'localhost:8081'}/ws`;

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

/** Survives reconnects (not app reloads), which is what gets a sleeping phone its seat back. */
const myId = Math.random().toString(36).slice(2) + Date.now().toString(36);
/** serverTime - localTime */
let offset = 0;
export const serverNow = () => Date.now() + offset;

type Bar = { tempo: number };
const barListeners = new Set<(b: Bar) => void>();
export const onBar = (f: (b: Bar) => void) => (barListeners.add(f), () => void barListeners.delete(f));

let ws: WebSocket | null = null;
let join: { name: string; room: string } | null = null; // room '' = host

/** No room = host a new one. */
export function connect(name: string, room = '') {
  join = { name, room: room.trim().toUpperCase() };
  set({ error: null, joining: true });
  open();
}

function open() {
  const sock = new WebSocket(SERVER_URL);
  ws = sock;
  sock.onopen = () => {
    set({ connected: true });
    if (join) send({ type: 'join', role: 'player', id: myId, name: join.name, ...(join.room && { room: join.room }) });
  };
  sock.onmessage = (e) => {
    const m: ServerMsg = JSON.parse(String(e.data));
    if (m.type === 'state') {
      offset = m.serverNow - Date.now();
      set({ state: m, joining: false });
    } else if (m.type === 'welcome') {
      if (join) join.room = m.room; // reconnects rejoin the same room instead of hosting a new one
      set({ seat: m.seat, error: null });
    }
    else if (m.type === 'bar') barListeners.forEach((f) => f({ tempo: m.tempo }));
    else if (m.type === 'kicked') {
      join = null; // don't auto-rejoin
      sock.close();
      set({ state: null, seat: 0, joining: false, error: 'You were removed from the room' });
    } else if (m.type === 'error') {
      if (!snap.state) join = null; // failed join: stop retrying
      set({ error: m.msg, joining: false });
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    set({ connected: false });
    if (!join) return; // intentional leave, removal, or a rejected join: keep its message
    if (!snap.state) {
      // Never got into a room: say so instead of retrying silently.
      join = null;
      return set({ joining: false, error: `Can't reach the server at ${SERVER_URL}` });
    }
    if (join) setTimeout(() => join && !ws && open(), 1000);
  };
}

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
