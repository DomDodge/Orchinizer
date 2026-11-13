// Dev-only: calibrate on 2–6 targets, then sweep and flick to see what the conductor's baton would select.
// Uses the same aim.ts/pointer.ts code as the real game. Open from the Sensor test screen.
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { angleDiff, createBaton, type Calib } from '../aim';
import { currentHeading, motionSupported, onSample } from '../pointer';
import { BG, Btn, DIM, FG, H1, P, Screen } from './ui';

const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];
const COLORS = ['#FF5252', '#FFB300', '#69F0AE', '#40C4FF', '#E040FB', '#FF6E40'];
const MIN_GAP = 20; // degrees; closer targets get flaky (Bryson's doc: seat players >= 20° apart)

export function PointTest({ onClose }: { onClose: () => void }) {
  const [count, setCount] = useState(4);
  const [raw, setRaw] = useState<number[] | null>(null); // null = choosing count
  const calibrated = raw !== null && raw.length === count;

  if (!motionSupported)
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <H1>Open this on a phone</H1>
        <Btn label="Back" onPress={onClose} />
      </Screen>
    );

  if (raw === null)
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <H1>Point &amp; select test</H1>
        <P>Stand people or objects in a semicircle around you, at least 20° apart. How many?</P>
        <View style={styles.row}>
          {[2, 3, 4, 5, 6].map((n) => (
            <Pressable key={n} onPress={() => setCount(n)} style={[styles.count, n === count && styles.countOn]}>
              <Text style={[styles.countText, n === count && { color: BG }]}>{n}</Text>
            </Pressable>
          ))}
        </View>
        <Btn label="Start calibrating" onPress={() => setRaw([])} />
        <Btn label="Back" color="#333" onPress={onClose} />
      </Screen>
    );

  if (!calibrated) {
    const i = raw.length;
    return (
      <Pressable
        style={{ flex: 1 }}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setRaw([...raw, currentHeading()]);
        }}
      >
        <Screen bg={COLORS[i] + '22'} style={{ justifyContent: 'center', alignItems: 'center' }}>
          <P color={FG}>
            Calibrating {i + 1} of {count}, left to right
          </P>
          <Text style={[styles.huge, { color: COLORS[i] }]}>{LABELS[i]}</Text>
          <H1>Point at {LABELS[i]}, then tap anywhere</H1>
          <Btn label="Start over" color="#333" onPress={() => setRaw(i ? [] : null)} />
        </Screen>
      </Pressable>
    );
  }

  return <Live raw={raw} onRecalibrate={() => setRaw([])} onClose={onClose} />;
}

function Live({ raw, onRecalibrate, onClose }: { raw: number[]; onRecalibrate: () => void; onClose: () => void }) {
  const calib: Calib = raw.map((h, i) => ({ seat: i + 1, angle: h }));
  const rel = raw.map((h) => angleDiff(h, raw[0]));
  const tooClose = rel.some((a, i) => i > 0 && Math.abs(angleDiff(a, rel[i - 1])) < MIN_GAP);
  const [selected, setSelected] = useState(0);
  const [cue, setCue] = useState<{ seat: number; n: number } | null>(null);
  const [heading, setHeading] = useState(0);

  useEffect(() => {
    const baton = createBaton(calib);
    let n = 0;
    let lastDraw = 0;
    return onSample((s) => {
      if (s.t - lastDraw > 100) {
        lastDraw = s.t;
        setHeading(angleDiff(s.heading, raw[0]));
      }
      for (const e of baton.update(s)) {
        if (e.type === 'select') {
          setSelected(e.seat);
          if (e.seat) Haptics.selectionAsync();
        } else if (e.type === 'flick') {
          setCue({ seat: e.seat, n: ++n });
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }
      }
    });
    // calib is derived from raw; re-create the baton only when the calibration changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  // Clear the cue flash after a moment.
  useEffect(() => {
    if (!cue) return;
    const t = setTimeout(() => setCue(null), 700);
    return () => clearTimeout(t);
  }, [cue]);

  const i = selected - 1;
  return (
    <Screen bg={selected ? COLORS[i] + '33' : BG}>
      <ScrollView contentContainerStyle={{ gap: 14 }}>
        <View style={styles.stage}>
          {cue ? (
            <Text style={[styles.cue, { color: COLORS[cue.seat - 1] }]}>CUE → {LABELS[cue.seat - 1]}</Text>
          ) : (
            <Text style={[styles.huge, { color: selected ? COLORS[i] : DIM }]}>{selected ? LABELS[i] : '—'}</Text>
          )}
          <P color={FG}>{selected ? `Pointing at ${LABELS[i]}` : 'Not pointing at anyone'}</P>
          <P>heading {Math.round(heading)}° (A = 0°)</P>
        </View>

        <View style={styles.row}>
          {rel.map((a, k) => (
            <View key={k} style={[styles.target, { borderColor: COLORS[k], backgroundColor: k === i ? COLORS[k] : 'transparent' }]}>
              <Text style={[styles.targetLabel, { color: k === i ? BG : COLORS[k] }]}>{LABELS[k]}</Text>
              <Text style={{ color: k === i ? BG : DIM, fontSize: 12 }}>{Math.round(a)}°</Text>
            </View>
          ))}
        </View>
        {tooClose && <P color="#FFB300">Some targets are under {MIN_GAP}° apart, so selection will be twitchy. Spread out.</P>}
        {rel.length > 1 && rel[1] < 0 && <P color="#FFB300">B came out left of A. Did you calibrate left to right? If so, heading is flipped. Tell the dev.</P>}

        <Btn label="Recalibrate" color="#333" onPress={onRecalibrate} />
        <Btn label="Back" color="#333" onPress={onClose} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  count: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: FG, alignItems: 'center', justifyContent: 'center' },
  countOn: { backgroundColor: FG },
  countText: { color: FG, fontSize: 20, fontWeight: '900' },
  huge: { fontSize: 160, fontWeight: '900', textAlign: 'center' },
  cue: { fontSize: 64, fontWeight: '900', textAlign: 'center', marginVertical: 48 },
  stage: { alignItems: 'center', minHeight: 300, justifyContent: 'center' },
  target: { width: 64, borderWidth: 3, borderRadius: 14, padding: 8, alignItems: 'center' },
  targetLabel: { fontSize: 26, fontWeight: '900' },
});
