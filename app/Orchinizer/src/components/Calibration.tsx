import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { selectSeat, TUNING, type Calib, type Sample } from '../aim';
import { captureIssue, clearCalibration, conflictingDirection, makeCalibration, saveCalibration } from '../calibration';
import { clearError, send, useNet, useSecondsLeft } from '../net';
import { motionSupported, onSample, startMotion } from '../pointer';
import { instrumentInfo, type State } from '../protocol';
import { BG, Btn, DIM, FG, H1, P, Screen, SeatBadge, Timer } from './ui';

type Motion = 'waiting' | 'steady' | 'moving' | 'unavailable';

export function Calibrate({ state }: { state: State }) {
  const seats = state.players.filter(p => p.instrument && p.seat !== state.conductor);
  const left = useSecondsLeft(state.deadline);
  const { error } = useNet();
  const [captured, setCaptured] = useState<Calib>([]);
  const [activeSeat, setActiveSeat] = useState<number | null>(seats[0]?.seat ?? null);
  const [motion, setMotion] = useState<Motion>(motionSupported ? 'waiting' : 'unavailable');
  const [aimedSeat, setAimedSeat] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = pending && !error;
  const latest = useRef<Sample | null>(null);
  const saved = useRef<Calib>([]);
  const aimed = useRef(0);
  const lastPaint = useRef(0);
  const submitted = useRef(false);
  const alive = useRef(false);
  const target = seats.find(p => p.seat === activeSeat);
  const complete = seats.length > 0 && seats.every(p => captured.some(direction => direction.seat === p.seat));
  const pointed = seats.find(p => p.seat === aimedSeat);

  useEffect(() => { saved.current = captured; }, [captured]);

  useEffect(() => {
    alive.current = true;
    clearCalibration();
    clearError();
    const off = onSample(sample => {
      if (!Number.isFinite(sample.heading)) return;
      latest.current = sample;
      if (sample.t - lastPaint.current < 100) return;
      lastPaint.current = sample.t;
      const steady = sample.accel < TUNING.freezeMs2;
      setMotion(steady ? 'steady' : 'moving');
      if (steady) {
        const seat = selectSeat(sample.heading, saved.current, aimed.current);
        if (seat !== aimed.current) {
          aimed.current = seat;
          setAimedSeat(seat);
        }
      }
    });
    void startMotion().then(ready => { if (alive.current && !ready) setMotion('unavailable'); });
    const freshness = setInterval(() => {
      if (latest.current && Date.now() - latest.current.t > 1000) setMotion('waiting');
    }, 500);
    return () => { alive.current = false; off(); clearInterval(freshness); };
  }, []);

  useEffect(() => {
    if (!error) return;
    clearCalibration();
  }, [error]);

  const choose = (seat: number) => { setActiveSeat(seat); setNotice(null); };
  const capture = () => {
    const sample = latest.current;
    const issue = captureIssue(sample);
    if (!target || !sample || issue === 'waiting') return setNotice('Waiting for a fresh motion reading. You can use button controls below.');
    if (issue === 'moving') return setNotice('Hold the phone still, then save the direction.');
    const conflict = conflictingDirection(captured, sample.heading, target.seat);
    if (conflict !== undefined) {
      const other = seats.find(p => p.seat === conflict);
      return setNotice(`Too close to ${other?.name ?? `seat ${conflict}`}. Give each player a separate direction and try again.`);
    }
    const next = [...captured.filter(direction => direction.seat !== target.seat), { seat: target.seat, angle: sample.heading }];
    setCaptured(next);
    setActiveSeat(seats.find(p => !next.some(direction => direction.seat === p.seat))?.seat ?? null);
    setNotice(null);
    void Haptics.selectionAsync().catch(() => {});
  };
  const finish = (buttons = false) => {
    if ((submitted.current && !error) || (!buttons && (!complete || target))) return;
    submitted.current = true;
    setPending(true);
    clearError();
    if (buttons) {
      clearCalibration();
      send({ type: 'calibrated', angles: {} });
    } else {
      // Keep join order even if the conductor recorded seats out of order.
      const directions = seats.map(p => captured.find(direction => direction.seat === p.seat)!);
      saveCalibration({ room: state.room, round: state.round, conductor: state.conductor }, directions);
      send({ type: 'calibrated', angles: makeCalibration(directions).angles });
    }
  };
  const undo = () => {
    const previous = captured[captured.length - 1];
    if (!previous) return;
    setCaptured(captured.filter(direction => direction.seat !== previous.seat));
    choose(previous.seat);
  };
  const reset = () => {
    setCaptured([]);
    setAimedSeat(0);
    aimed.current = 0;
    choose(seats[0]?.seat ?? 0);
    clearCalibration();
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>ORCHESTRA SETUP · ROUND {state.round}</Text>
          <Text style={styles.progress}>{captured.length} of {seats.length} directions saved</Text>
        </View>
        <Timer left={left} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <H1>{motion === 'unavailable' ? 'You’re the conductor' : target ? 'Point at this player' : complete ? 'Check your aim' : 'Get ready to conduct'}</H1>
        <P>{motion === 'unavailable' ? 'Your orchestra is ready. Bring each part in and out with the on-screen buttons.' : 'Stay in one place. Hold your phone comfortably and point its top edge toward each player.'}</P>

        {motion !== 'unavailable' && target && (
          <View style={[styles.target, { borderColor: target.color, backgroundColor: target.color + '15' }]}>
            <SeatBadge seat={target.seat} color={target.color} size={112} />
            <H1 color={target.color}>{target.name}</H1>
            <P color={FG}>{instrumentInfo(target.instrument).emoji} {instrumentInfo(target.instrument).label}</P>
            {target.bot && <P>Virtual player: choose a distinct spot in the room for this part.</P>}
            {!target.connected && <P>This player is offline. Keep their original spot or use button controls.</P>}
          </View>
        )}
        {complete && !target && motion !== 'unavailable' && (
          <View style={[styles.target, { borderColor: pointed?.color ?? '#33334A' }]}>
            <P>Slowly point around the orchestra. Does each name match?</P>
            <H1 color={pointed?.color ?? FG}>{motion === 'steady' ? pointed?.name ?? 'Point at a player' : 'Hold the phone steady'}</H1>
            {pointed && <P color={pointed.color}>Seat {pointed.seat} · {instrumentInfo(pointed.instrument).label}</P>}
            <P>Tap a player below to redo their direction.</P>
          </View>
        )}
        {motion === 'unavailable' && (
          <View style={styles.target}>
            <H1>Use button controls</H1>
            <P>{motionSupported ? 'Motion is unavailable or permission was not granted.' : 'Pointing is available in the native phone app. This browser uses buttons.'}</P>
            <P>You can still bring every part in and out from the performance screen.</P>
          </View>
        )}

        <View style={styles.roster}>
          {seats.map(p => {
            const done = captured.some(direction => direction.seat === p.seat);
            const active = p.seat === activeSeat;
            return (
              <Pressable key={p.seat} disabled={submitting || motion === 'unavailable'} onPress={() => choose(p.seat)}
                accessibilityRole="button" accessibilityLabel={`${p.name}, seat ${p.seat}, ${done ? 'direction saved, tap to redo' : 'direction needed'}`}
                accessibilityState={{ selected: active, disabled: submitting || motion === 'unavailable' }}
                style={[styles.member, { borderColor: active || done ? p.color : '#33334A', backgroundColor: active ? p.color + '25' : '#15151F' }]}>
                <Text style={[styles.memberSeat, { color: p.color }]}>{done ? '✓' : p.seat}</Text>
                <Text numberOfLines={1} style={styles.memberName}>{p.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {(notice || error) && <P color="#FFB300">{notice || error}</P>}
        {motion !== 'unavailable' && <P>{motion === 'steady' ? target ? 'Hold this direction and tap Save.' : 'Ready when the directions feel right.' : motion === 'moving' ? 'Hold the phone still to save.' : 'Waiting for motion readings…'}</P>}
        {submitting ? <P color={FG}>Starting the performance…</P> : motion === 'unavailable' || seats.length === 0 ? (
          <Btn label="Start with buttons" onPress={() => finish(true)} />
        ) : target ? (
          <Btn label={`Save direction · ${target.name}`} disabled={motion !== 'steady'} onPress={() => capture()} />
        ) : (
          <Btn label="Start performing" disabled={!complete || motion !== 'steady'} onPress={() => finish()} />
        )}
        {captured.length > 0 && !submitting && <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={undo} style={styles.smallButton}><Text style={styles.actionText}>Undo last</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={reset} style={styles.smallButton}><Text style={styles.actionText}>Start over</Text></Pressable>
        </View>}
        {motion !== 'unavailable' && !submitting && <Pressable accessibilityRole="button" onPress={() => finish(true)} style={styles.fallback}>
          <Text style={styles.actionText}>Use button controls instead</Text>
        </Pressable>}
        <Text style={styles.hint}>If the timer ends before you finish, you’ll use button controls.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  eyebrow: { color: DIM, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  progress: { color: FG, fontSize: 16, fontWeight: '800', marginTop: 4 },
  content: { gap: 16, paddingBottom: 16 },
  target: { alignItems: 'center', gap: 10, padding: 18, borderRadius: 20, borderWidth: 2, borderColor: '#33334A', backgroundColor: BG },
  roster: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  member: { flexGrow: 1, flexBasis: '30%', minWidth: 84, padding: 10, borderWidth: 2, borderRadius: 12, alignItems: 'center', gap: 4 },
  memberSeat: { fontSize: 23, fontWeight: '900' },
  memberName: { color: FG, fontSize: 13, fontWeight: '700', maxWidth: '100%' },
  footer: { gap: 8, borderTopWidth: 1, borderTopColor: '#252536', paddingTop: 12 },
  actions: { flexDirection: 'row', gap: 8 },
  smallButton: { flex: 1, padding: 10, backgroundColor: '#252536', borderRadius: 10, alignItems: 'center' },
  fallback: { padding: 10, alignItems: 'center' },
  actionText: { color: FG, fontSize: 14, fontWeight: '700' },
  hint: { color: DIM, fontSize: 12, textAlign: 'center' },
});
