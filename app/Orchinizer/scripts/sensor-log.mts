// Receives the Sensor test screen's stream. Prints ~4 lines/s and saves every sample to sensor-log.csv.
// Run: npm run sensor-log   (phone and laptop on the same Wi-Fi)
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = 8090;
const FLICK = 8; // keep in sync with TUNING.flickMs2 in src/aim.ts
const FILE = 'sensor-log.csv';
const COLS = ['t', 'heading', 'elevation', 'accel', 'rot_a', 'rot_b', 'rot_g', 'g_x', 'g_y', 'g_z', 'a_x', 'a_y', 'a_z', 'att_a', 'att_b', 'att_g'];

type Row = {
  t: number;
  heading: number;
  elevation: number;
  accel: number;
  raw: {
    rotationRate?: { alpha: number; beta: number; gamma: number };
    accelerationIncludingGravity?: { x: number; y: number; z: number };
    acceleration?: { x: number; y: number; z: number };
    rotation?: { alpha: number; beta: number; gamma: number };
  };
};

writeFileSync(FILE, COLS.join(',') + '\n');
let lastPrint = 0;
let count = 0;
const n = (v: number | undefined, d = 1) => (v ?? NaN).toFixed(d).padStart(7);

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.end('ok');
    let rows: Row[];
    try {
      rows = JSON.parse(body);
    } catch {
      return;
    }
    appendFileSync(
      FILE,
      rows
        .map((r) => {
          const { rotationRate: w, accelerationIncludingGravity: g, acceleration: a, rotation: o } = r.raw;
          return [r.t, r.heading, r.elevation, r.accel, w?.alpha, w?.beta, w?.gamma, g?.x, g?.y, g?.z, a?.x, a?.y, a?.z, o?.alpha, o?.beta, o?.gamma].join(',');
        })
        .join('\n') + '\n',
    );
    count += rows.length;
    const peak = Math.max(...rows.map((r) => r.accel));
    const last = rows.at(-1)!;
    if (peak > FLICK || last.t - lastPrint > 250) {
      lastPrint = last.t;
      console.log(
        `heading${n(last.heading, 0)}°  tilt${n(last.elevation, 0)}°  accel${n(last.accel)}  ${peak > FLICK ? `💥 FLICK peak ${peak.toFixed(1)}` : ''}  (${count} samples)`,
      );
    }
  });
}).listen(PORT, () => console.log(`sensor-log listening on :${PORT}, writing ${FILE}`));
