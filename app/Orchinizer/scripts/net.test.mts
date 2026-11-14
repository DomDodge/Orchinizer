import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercise the real client handlers without loading Expo's native modules in Node.
const source = ts.transpileModule(readFileSync(new URL('../src/net.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function client(serverUrl = 'ws://localhost:8080/ws') {
  const sockets: FakeSocket[] = [];
  const retries: (() => void)[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    onopen = () => {};
    onmessage = (_e: { data: string }) => {};
    onclose = () => {};
    sent: object[] = [];
    constructor(_url: string) { sockets.push(this); }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
    receive(message: object) { this.onmessage({ data: JSON.stringify(message) }); }
  }
  const exports: Record<string, any> = {};
  runInNewContext(source, {
    exports, WebSocket: FakeSocket, process: { env: { EXPO_PUBLIC_SERVER_URL: serverUrl } },
    setTimeout: (f: () => void) => retries.push(f),
    require: (name: string) => {
      if (name === 'react') return { useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot() };
      if (name === 'react-native') return { AppState: { addEventListener: () => {} } };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  exports.connect('Ana', 'ABCD');
  const socket = sockets[0];
  socket?.onopen();
  return { net: exports, socket, retries, sockets };
}

test('kicked client returns home, keeps the removal message and never retries', () => {
  const { net, socket, retries } = client();
  socket.receive({ type: 'welcome', room: 'ABCD', seat: 2, token: 'seat-token' });
  socket.receive({ type: 'state', serverTime: Date.now(), players: [] });
  socket.receive({ type: 'kicked' });
  socket.onclose();
  const snap = net.useNet();
  assert.equal(snap.state, null);
  assert.equal(snap.seat, 0);
  assert.equal(snap.connected, false);
  assert.equal(snap.joining, false);
  assert.equal(snap.error, 'You were removed from the room');
  assert.equal(retries.length, 0);
});

test('leaving intentionally does not show a server connection error', () => {
  const { net, socket, retries } = client();
  socket.receive({ type: 'state', serverTime: Date.now(), players: [] });
  net.leave();
  socket.onclose();
  assert.equal(net.useNet().error, null);
  assert.equal(retries.length, 0);
});

test('failed initial connection still explains the failure', () => {
  const { net, socket, retries } = client();
  socket.onclose();
  assert.match(net.useNet().error, /Can't reach the server/);
  assert.equal(net.useNet().joining, false);
  assert.equal(retries.length, 0);
});

test('unintentional disconnect after joining still reconnects to the same room', () => {
  const { net, socket, retries, sockets } = client();
  socket.receive({ type: 'welcome', room: 'ABCD', seat: 2, token: 'seat-token' });
  socket.receive({ type: 'state', serverTime: Date.now(), players: [] });
  socket.onclose();
  assert.equal(net.useNet().connected, false);
  assert.equal(retries.length, 1);
  retries[0]();
  sockets[1].onopen();
  const rejoin = sockets[1].sent[0] as { room: string; token: string };
  assert.equal(rejoin.room, 'ABCD');
  assert.equal(rejoin.token, 'seat-token');
});

test('missing server configuration shows an error without opening a connection', () => {
  const { net, sockets } = client('');
  assert.equal(sockets.length, 0);
  assert.equal(net.useNet().joining, false);
  assert.equal(net.useNet().error, 'The game server is not configured yet.');
});

test('a rejected reconnect clears the old room and stops retrying', () => {
 const { net, socket, retries, sockets } = client();
 socket.receive({ type: 'welcome', room: 'ABCD', seat: 2, token: 'old-token' });
 socket.receive({ type: 'state', serverTime: Date.now(), players: [] });
 socket.onclose(); retries.shift()!(); sockets[1].onopen();
 sockets[1].receive({ type: 'error', code: 'not_allowed', message: 'Seat removed' });
 sockets[1].onclose();
 assert.equal(net.useNet().state, null);
 assert.equal(net.useNet().error, 'Seat removed');
 assert.equal(retries.length, 0);
});
test('serverTime drives countdowns using the shared protocol', () => {
 const { net, socket } = client();
 const time = Date.now()+30000;
 socket.receive({ type: 'state', serverTime: time, players: [] });
 assert.ok(Math.abs(net.serverNow()-time)<1000);
});
