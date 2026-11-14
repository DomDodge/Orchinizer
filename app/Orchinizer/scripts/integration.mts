// Real phone networking against Go, with a simulated TV (no TV UI).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { createServer } from 'node:net';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync(new URL('../src/net.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test('phone lobby → token reconnect → two conductor rounds → scores → restart', { timeout: 120000 }, async () => {
  const binary = join(mkdtempSync(join(tmpdir(), 'orchinizer-integration-')), 'server');
  execFileSync('go', ['build', '-o', binary, './cmd/server'], { cwd: new URL('../../../server/', import.meta.url) });
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const server = spawn(binary, [], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
  const url = `ws://127.0.0.1:${port}/ws`;
  let logs = ''; const phones: any[] = []; let tv: WebSocket | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.on('exit', code => reject(new Error(`Server exited ${code}: ${logs}`)));
      server.stderr.on('data', data => { logs += data; if (logs.includes('listening')) resolve(); });
    });
    function phone(name: string, room = '') {
      const changes = new EventEmitter(), sockets: WebSocket[] = [];
      class Socket extends WebSocket { constructor(address: string) { super(address); sockets.push(this); } }
      const api: any = {}; let subscribed = false;
      runInNewContext(source, {
        exports: api, WebSocket: Socket, process: { env: { EXPO_PUBLIC_SERVER_URL: url } },
        setTimeout, clearTimeout, setInterval, clearInterval,
        require: (name: string) => {
          assert.equal(name, 'react');
          return { useSyncExternalStore: (subscribe: any, getSnapshot: any) => {
            if (!subscribed) { subscribed = true; subscribe(() => changes.emit('change')); }
            return getSnapshot();
          } };
        },
      });
      const wait = (predicate: (snap: any) => boolean, timeout = 5000) => new Promise<any>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const check = () => { const snap = api.useNet(); if (predicate(snap)) { clearTimeout(timer); changes.off('change', check); resolve(snap); } };
        timer = setTimeout(() => { changes.off('change', check); reject(new Error(`Waiting for ${name}: ${JSON.stringify(api.useNet())}`)); }, timeout);
        changes.on('change', check); check();
      });
      api.useNet(); api.connect(name, room);
      const p = { api, wait, sockets }; phones.push(p); return p;
    }
    const host = phone('Host');
    const initial = await host.wait(s => s.state?.players.length === 1), room = initial.state.room;
    assert.equal(initial.state.host, initial.seat); assert.equal(initial.state.tvConnected, false);
    const guest = phone('Guest', room), removed = phone('Offline', room);
    await host.wait(s => s.state.players.length === 3);
    await guest.wait(s => !!s.state); await removed.wait(s => !!s.state);
    host.api.send({ type: 'pick', instrument: 'piano' });
    await host.wait(s => s.state.players[0].instrument === 'piano');
    guest.api.send({ type: 'pick', instrument: 'piano' });
    await guest.wait(s => !!s.error); guest.api.clearError();
    guest.api.send({ type: 'pick', instrument: 'cello' }); removed.api.send({ type: 'pick', instrument: 'drums' });
    await host.wait(s => s.state.players.every((p: any) => p.instrument));
    const removedSeat = removed.api.useNet().seat;
    removed.sockets[0].close();
    await host.wait(s => !s.state.players.find((p: any) => p.seat === removedSeat).connected);
    host.api.send({ type: 'kick', seat: removedSeat }); await host.wait(s => s.state.players.length === 2);
    await removed.wait(s => !s.state && !!s.error);
    host.api.send({ type: 'host_action', action: 'start' }); await host.wait(s => !!s.error);
    assert.equal(host.api.useNet().state.phase, 'lobby'); host.api.clearError();
    tv = new WebSocket(url); await once(tv, 'open');
    // The fake TV hears each cue right on the seat's next open target, so it scores perfect.
    let tvState: any;
    tv.addEventListener('message', e => {
      const m = JSON.parse(String(e.data));
      if (m.type === 'state') tvState = m;
      if (m.type !== 'cue') return;
      const t = tvState?.targets.find((t: any) => t.seat === m.seat && !t.grade);
      const heard = t ? t.beat + (100 * tvState.tempo) / 60000 : 0;
      tv!.send(JSON.stringify({ ...m, type: 'cue_scheduled', beat: 4, heard }));
    });
    tv.send(JSON.stringify({ type: 'join', role: 'tv', room })); await host.wait(s => s.state.tvConnected);
    const next = () => tv!.send(JSON.stringify({ type: 'host_action', action: 'next' }));
    host.api.send({ type: 'host_action', action: 'start' });
    await host.wait(s => s.state.phase === 'compose'); await guest.wait(s => s.state.phase === 'compose');
    const steps = Array.from({ length: 5 }, () => Array(8).fill(false)); steps[1][2] = true;
    guest.api.send({ type: 'pattern', steps }); const guestSeat = guest.api.useNet().seat;
    await host.wait(s => s.state.patterns[guestSeat][1][2]);
    guest.sockets[0].close(); await guest.wait(s => !s.connected);
    assert.equal((await guest.wait(s => s.connected && s.state.patterns[guestSeat][1][2])).seat, guestSeat);
    next(); await host.wait(s => s.state.phase === 'calibrate');
    host.api.send({ type: 'calibrated', angles: {} }); await host.wait(s => s.state.phase === 'perform');
    host.api.send({ type: 'cue', id: 'in-1', seat: guestSeat, action: 'in' }); await host.wait(s => s.state.live[guestSeat] === 80);
    host.api.send({ type: 'volume', seat: guestSeat, level: 35 }); await host.wait(s => s.state.live[guestSeat] === 35);
    host.api.send({ type: 'cue', id: 'stop-all', seat: 0, action: 'all_out' }); await host.wait(s => Object.keys(s.state.live).length === 0);
    next(); await guest.wait(s => s.state.phase === 'compose' && s.state.round === 2);
    assert.equal(guest.api.useNet().state.conductor, guestSeat); await host.wait(s => s.state.round === 2);
    assert.equal(host.api.useNet().state.players.find((p: any) => p.seat === initial.seat).instrument, 'piano');
    next(); await guest.wait(s => s.state.phase === 'calibrate'); guest.api.send({ type: 'calibrated', angles: {} });
    await guest.wait(s => s.state.phase === 'perform');
    guest.api.send({ type: 'cue', id: 'in-2', seat: initial.seat, action: 'in' }); await host.wait(s => s.state.live[initial.seat] === 80);
    next(); await host.wait(s => s.state.phase === 'results'); await guest.wait(s => s.state.phase === 'results');
    const [r1, r2] = host.api.useNet().state.performances;
    assert.ok(r1.perfect >= 1 && r1.score === r1.perfect * 100 + r1.good * 50, JSON.stringify(r1));
    assert.ok(r2.perfect >= 1, JSON.stringify(r2));
    assert.equal(host.api.useNet().state.winner, r1.score >= r2.score ? 1 : 2);
    host.api.send({ type: 'host_action', action: 'restart' }); await host.wait(s => s.state.phase === 'lobby' && s.state.players.length === 2);
    const online = phone('Online', room); await online.wait(s => !!s.state);
    host.api.send({ type: 'kick', seat: online.api.useNet().seat }); await online.wait(s => !s.state && s.error === 'You were removed from the room');
    guest.api.leave(); await host.wait(s => s.state.players.length === 1); assert.equal(host.api.useNet().error, null);
  } finally {
    for (const p of phones) { p.api.leave(); for (const socket of p.sockets) socket.close(); }
    tv?.close(); server.kill('SIGTERM'); await once(server, 'exit');
  }
});
