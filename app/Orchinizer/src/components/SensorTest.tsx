// Dev-only: live pointer.ts readings, optionally streamed to `npm run sensor-log` on the laptop.
// Open it by long-pressing the title on the Join screen. The Point & select test hangs off here.
import type { DeviceMotionMeasurement } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { createFlickDetector, TUNING, type Sample } from '../aim';
import Constants from 'expo-constants';
import { motionSupported, onSample } from '../pointer';
import { PointTest } from './PointTest';
import { Btn, DIM, FG, H1, P, Screen } from './ui';

// Post to the Metro dev server the app was loaded from (LAN or tunnel); metro.config.js forwards to the laptop logger.
const metroHost = Constants.expoConfig?.hostUri ?? 'localhost:8081';
const LOG_URL = `${metroHost.endsWith('.exp.direct') ? 'https' : 'http'}://${metroHost}/sensor-log`;
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const f = (n: number | undefined, d = 1) => (n == null ? '—' : n.toFixed(d).padStart(7));

type Row = Sample & { raw: DeviceMotionMeasurement };

export function SensorTest({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<{ s: Row; hz: number } | null>(null);
  const [zero, setZero] = useState(0);
  const [flicks, setFlicks] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const latest = useRef<Row | null>(null);
  const count = useRef(0);
  const [isFlick] = useState(createFlickDetector);
  const batch = useRef<Row[]>([]);
  const [pointTest, setPointTest] = useState(false);

  useEffect(
    () =>
      onSample((s, raw) => {
        const row = { ...s, raw };
        latest.current = row;
        count.current++;
        batch.current.push(row);
        if (isFlick(s)) setFlicks((n) => n + 1);
      }),
    [isFlick],
  );

  // Redraw at 10 Hz; measure the real sample rate once a second.
  useEffect(() => {
    let hz = 0;
    let since = Date.now();
    const id = setInterval(() => {
      if (Date.now() - since >= 1000) {
        hz = count.current;
        count.current = 0;
        since = Date.now();
      }
      if (latest.current) setView({ s: latest.current, hz });
    }, 100);
    return () => clearInterval(id);
  }, []);

  // Ship batched samples to the laptop every 100 ms while streaming.
  useEffect(() => {
    if (!streaming) return;
    batch.current = [];
    const id = setInterval(() => {
      const rows = batch.current;
      batch.current = [];
      if (!rows.length) return;
      fetch(LOG_URL, { method: 'POST', body: JSON.stringify(rows) })
        .then(async (res) => setSendError(res.ok ? null : await res.text()))
        .catch((e) => setSendError(String(e)));
    }, 100);
    return () => clearInterval(id);
  }, [streaming]);

  if (pointTest) return <PointTest onClose={() => setPointTest(false)} />;

  if (!motionSupported)
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <H1>Open this on a phone</H1>
        <P>The web build has no motion sensors.</P>
        <Btn label="Back" onPress={onClose} />
      </Screen>
    );

  const s = view?.s;
  const r = s?.raw.rotationRate;
  const g = s?.raw.accelerationIncludingGravity;
  const a = s?.raw.acceleration;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <H1>Sensor test</H1>
        <Btn label="Point & select test →" onPress={() => setPointTest(true)} />
        <View style={styles.big}>
          <Stat label="Heading°" value={f(s && wrap(s.heading - zero), 0)} hint="turn right → goes up" />
          <Stat label="Tilt°" value={f(s?.elevation, 0)} hint="top edge up → goes up" />
          <Stat label="Accel" value={f(s?.accel)} hint={`m/s² · flick > ${TUNING.flickMs2}`} />
          <Stat label="Flicks" value={String(flicks)} hint={`${view?.hz ?? 0} Hz`} />
        </View>
        <Text style={styles.raw}>
          {`rotationRate (deg/s)  α${f(r?.alpha)} β${f(r?.beta)} γ${f(r?.gamma)}\n`}
          {`accel+gravity (m/s²)  x${f(g?.x)} y${f(g?.y)} z${f(g?.z)}\n`}
          {`accel (m/s²)          x${f(a?.x)} y${f(a?.y)} z${f(a?.z)}`}
        </Text>
        <Btn label="Zero heading" color="#333" onPress={() => s && setZero(s.heading)} />
        <Btn
          label={streaming ? '■ Stop streaming' : `▶ Stream to laptop`}
          color={streaming ? '#FF5252' : '#6C63FF'}
          onPress={() => setStreaming(!streaming)}
        />
        <P>{streaming ? (sendError ? `${sendError} (${LOG_URL})` : `Sending to ${LOG_URL}`) : 'Run npm run sensor-log on the laptop first'}</P>
        <Btn label="Back" color="#333" onPress={onClose} />
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value.trim()}</Text>
      <Text style={styles.statHint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  big: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { width: '48%', backgroundColor: '#1A1A26', borderRadius: 14, padding: 12 },
  statLabel: { color: DIM, fontWeight: '700' },
  statValue: { color: FG, fontSize: 40, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statHint: { color: DIM, fontSize: 12 },
  raw: { color: FG, fontFamily: 'Courier', fontSize: 11, backgroundColor: '#000', padding: 10, borderRadius: 10 },
});
