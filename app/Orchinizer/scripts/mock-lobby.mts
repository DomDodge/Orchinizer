// Dev-only stand-in for Bryson's server: lobby messages only (join, leave, kick, disconnect, categories, pick).
// metro.config.js mounts it on the Expo dev server at /ws, so phones reach it over --tunnel too.
// The real server must follow the same rules; see PROTOCOL.md "Lobby".
import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { ALL_CATEGORIES, INSTRUMENTS, type Category, type ClientMsg, type Player, type State } from '../src/protocol.ts';

const COLORS = ['#FF5252', '#FFB300', '#69F0AE', '#40C4FF', '#E040FB', '#FF6E40', '#EEFF41', '#18FFFF'];
const MAX_PLAYERS = 8;

type Member = Player & { id: string };
/** players is in join order: [0] is the host and conducts round 1, then rotation follows this order. */
export type Room = { code: string; players: Member[]; categories: Category[] };

export function newRoom(code: string): Room {
  return { code, players: [], categories: [...ALL_CATEGORIES] };
}

/** Adds or re-attaches a player. Returns an error message, or null. */
export function joinRoom(room: Room, id: string, name: string): string | null {
  const existing = room.players.find((p) => p.id === id);
  if (existing) {
    existing.online = true;
    existing.name = clean(name) || existing.name;
    return null;
  }
  if (room.players.length >= MAX_PLAYERS) return 'Room is full';
  const used = new Set(room.players.map((p) => p.seat));
  let seat = 1;
  while (used.has(seat)) seat++;
  room.players.push({ id, seat, name: clean(name) || `Player ${seat}`, color: COLORS[seat - 1], instrument: '', online: true, bot: false, notes: 0 });
  return null;
}

/** Applies a lobby message from player `id`. Returns an error message, or null. */
export function applyMsg(room: Room, id: string, m: ClientMsg): string | null {
  const me = room.players.find((p) => p.id === id);
  if (!me) return 'Not in this room';
  switch (m.type) {
    case 'categories': {
      if (room.players[0] !== me) return 'Only the conductor picks categories';
      const cats = ALL_CATEGORIES.filter((c) => Array.isArray(m.categories) && m.categories.includes(c));
      if (!cats.length) return 'Pick at least one category';
      room.categories = cats;
      for (const p of room.players) if (p.instrument && !cats.includes(INSTRUMENTS[p.instrument].category)) p.instrument = '';
      return null;
    }
    case 'pick': {
      if (m.instrument === null) {
        me.instrument = '';
        return null;
      }
      const info = INSTRUMENTS[m.instrument];
      if (!info) return 'Unknown instrument';
      if (!room.categories.includes(info.category)) return `${info.label} isn't in this game`;
      const owner = room.players.find((p) => p.instrument === m.instrument && p !== me);
      if (owner) return `${owner.name} already picked ${info.label}`;
      me.instrument = m.instrument;
      return null;
    }
    case 'leave':
      room.players = room.players.filter((p) => p !== me);
      return null;
    case 'kick': {
      if (room.players[0] !== me) return 'Only the conductor can remove players';
      const target = room.players.find((p) => p.seat === m.seat);
      if (!target || target === me) return 'No such player';
      room.players = room.players.filter((p) => p !== target);
      return null;
    }
    default:
      return null; // game phases are Bryson's server; the mock only does the lobby
  }
}

export function stateOf(room: Room): State {
  return {
    type: 'state', room: room.code, phase: 'lobby', round: 0, rounds: Math.min(room.players.length, 3),
    conductor: room.players[0]?.seat ?? 0, key: '', tempo: 0, deadline: 0, serverNow: Date.now(),
    players: room.players.map(({ id: _id, ...p }) => p), patterns: {}, live: {}, performances: [], winner: 0,
    categories: room.categories,
  };
}

const clean = (s: unknown) => (typeof s === 'string' ? s.trim().slice(0, 16) : '');

// ---- WebSocket glue -------------------------------------------------------------------------------------

const rooms = new Map<string, Room>();
const sockets = new Map<string, WebSocket>(); // player id -> socket
const log = (...a: unknown[]) => console.log('[mock-lobby]', ...a);

function broadcast(room: Room) {
  const msg = JSON.stringify(stateOf(room));
  for (const p of room.players) sockets.get(p.id)?.send(msg);
}

function onConnection(ws: WebSocket) {
  let room: Room | undefined;
  let id = '';
  const send = (m: object) => ws.send(JSON.stringify(m));

  ws.on('message', (raw) => {
    let m: ClientMsg;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.type === 'join') {
      if (typeof m.id !== 'string' || !m.id) return;
      const code = clean(m.room).toUpperCase();
      let r = code ? rooms.get(code) : undefined;
      if (code && !r) return send({ type: 'error', msg: `Room ${code} not found` });
      if (!r) {
        let c = '';
        while (!c || rooms.has(c)) c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
        rooms.set(c, (r = newRoom(c)));
        log(`${c} hosted`);
      }
      const err = joinRoom(r, m.id, m.name);
      if (err) return send({ type: 'error', msg: err });
      const old = sockets.get(m.id);
      if (old && old !== ws) old.close();
      [room, id] = [r, m.id];
      sockets.set(id, ws);
      const me = r.players.find((p) => p.id === id)!;
      log(`${r.code}: ${me.name} joined (seat ${me.seat})`);
      send({ type: 'welcome', room: r.code, seat: me.seat });
      return broadcast(r);
    }
    if (!room) return;
    const kickedId = m.type === 'kick' ? room.players.find((p) => p.seat === m.seat)?.id : undefined;
    const err = applyMsg(room, id, m);
    if (err) return send({ type: 'error', msg: err });
    if (kickedId) {
      const s = sockets.get(kickedId);
      sockets.delete(kickedId); // before close, so its close handler doesn't mark it offline
      s?.send(JSON.stringify({ type: 'kicked' }));
      s?.close();
      log(`${room.code}: seat ${m.type === 'kick' && m.seat} removed`);
    }
    if (m.type === 'leave') {
      sockets.delete(id);
      log(`${room.code}: ${id} left`);
      if (!room.players.length) rooms.delete(room.code);
      ws.close();
      const r = room;
      room = undefined;
      return broadcast(r);
    }
    broadcast(room);
  });

  ws.on('close', () => {
    if (!room || sockets.get(id) !== ws) return;
    sockets.delete(id);
    const me = room.players.find((p) => p.id === id);
    if (me) me.online = false; // keep the seat and pick so a phone that slept can rejoin
    log(`${room.code}: ${me?.name} disconnected`);
    broadcast(room);
  });
}

/** Mounts the lobby at `path` on every Node HTTP server in this process (i.e. Metro's). Metro destroys
 *  upgrades it doesn't recognize, so this intercepts them first. */
export function attachMockLobby(path = '/ws') {
  const g = globalThis as { __mockLobby?: boolean };
  if (g.__mockLobby) return;
  g.__mockLobby = true;
  const wss = new WebSocketServer({ noServer: true });
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (this: http.Server, event: string, ...args: unknown[]) {
    const [req, socket, head] = args as [http.IncomingMessage, import('node:stream').Duplex, Buffer];
    if (event === 'upgrade' && req.url?.split('?')[0] === path) {
      wss.handleUpgrade(req, socket, head, onConnection);
      return true;
    }
    return emit.call(this, event, ...args);
  } as typeof emit;
  log(`listening on ${path}`);
}
