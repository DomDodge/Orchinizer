import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { angleDiff, createBaton, type Calib } from '../aim';
import { send, useSecondsLeft } from '../net';
import { currentHeading, motionSupported, onSample, startMotion } from '../pointer';
import { instrumentInfo, type Player, type State } from '../protocol';
import { BeatRing } from './Pulse';
import { BG, Btn, FG, H1, P, Screen, Timer } from './ui';

// Calibrate hands this to Perform. Reset every round.
let calib: Calib = [];
const band = (s: State) => s.players.filter((p) => p.instrument && p.seat !== s.conductor);
let cueN = 0;
const cueId = () => `${Date.now().toString(36)}-${cueN++}`;

/** Calibrate phase for the conductor: a 3 s handoff, then "point at seat N and tap" for each seat. */
export function Calibrate({ state }: { state: State }) {
  const [handoff, setHandoff] = useState(3);
  const [raw, setRaw] = useState<number[]>([]);
  const seats = band(state);
  const target = seats[raw.length];

  useEffect(() => {
    calib = [];
    startMotion(); // warm the sensor before the first tap
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const id = setInterval(() => setHandoff((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const finish = (headings: number[]) => {
    calib = seats.map((p, i) => ({ seat: p.seat, angle: angleDiff(headings[i], headings[0]) }));
    send({ type: 'calibrated', angles: Object.fromEntries(calib.map((c) => [c.seat, Math.round(c.angle)])) });
  };

  const tap = () => {
    const next = [...raw, currentHeading()];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRaw(next);
    if (next.length === seats.length) finish(next);
  };

  if (handoff > 0)
    return (
      <Screen bg="#6C63FF" style={{ justifyContent: 'center' }}>
        <H1>You&apos;re conducting!</H1>
        <Text style={styles.huge}>{handoff}</Text>
      </Screen>
    );

  if (!motionSupported)
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <H1>No motion sensors here</H1>
        <P>You&apos;ll conduct with on-screen buttons.</P>
        <Btn label="Start performing" onPress={() => send({ type: 'calibrated', angles: {} })} />
      </Screen>
    );

  if (!target)
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <H1>Calibrated ✓</H1>
        <P>Starting the performance…</P>
      </Screen>
    );

  return (
    <Pressable style={{ flex: 1 }} onPress={tap}>
      <Screen bg={target.color + '22'} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <P color={FG}>
          Point at seat {raw.length + 1} of {seats.length}
        </P>
        <Text style={[styles.huge, { color: target.color }]}>{target.seat}</Text>
        <H1 color={target.color}>{target.name}</H1>
        <P>…then tap anywhere</P>
        {raw.length > 0 && <Btn label="Redo" color="#333" onPress={() => setRaw([])} />}
      </Screen>
    </Pressable>
  );
}

/** Perform phase: point + flick to toggle parts, tilt for volume, point down and hold for the big finish. */
export function Perform({ state }: { state: State }) {
  const left = useSecondsLeft(state.deadline);
  const [selected, setSelected] = useState(0);
  const [buttons, setButtons] = useState(!motionSupported || calib.length === 0);
  const live = useRef(state.live);
  const sel = useRef(0);
  useEffect(() => {
    live.current = state.live;
  }, [state.live]);

  const cue = (seat: number) => {
    if (!seat) return;
    send({ type: 'cue', id: cueId(), seat, action: live.current[seat] != null ? 'out' : 'in' });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  };

  useEffect(() => {
    if (buttons) return;
    const baton = createBaton(calib);
    return onSample((s) => {
      for (const e of baton.update(s)) {
        if (e.type === 'select') {
          sel.current = e.seat;
          setSelected(e.seat);
          send({ type: 'select', seat: e.seat });
          if (e.seat) Haptics.selectionAsync();
        } else if (e.type === 'flick') cue(e.seat);
        else if (e.type === 'volume' && live.current[sel.current] != null) send({ type: 'volume', seat: sel.current, level: e.level });
        else if (e.type === 'allOut') {
          send({ type: 'cue', id: cueId(), seat: 0, action: 'all_out' });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }
      }
    });
  }, [buttons]);

  const players = band(state);
  const p = players.find((x) => x.seat === selected);
  const isLive = (x: Player) => state.live[x.seat] != null;

  return (
    <Screen bg={p ? p.color + '33' : BG}>
      {/* Long-press the header for the hidden fallback: on-screen cue buttons. */}
      <Pressable onLongPress={() => setButtons(!buttons)} style={styles.header}>
        <Text style={styles.headerText}>🎼 Conducting</Text>
        <Timer left={left} />
      </Pressable>

      {buttons ? (
        <View style={styles.buttons}>
          {players.map((x) => (
            <Pressable
              key={x.seat}
              onPress={() => cue(x.seat)}
              style={[styles.cueBtn, { borderColor: x.color, backgroundColor: isLive(x) ? x.color : '#15151F' }]}
            >
              <Text style={[styles.cueSeat, { color: isLive(x) ? BG : x.color }]}>{x.seat}</Text>
              <Text style={[styles.cueName, { color: isLive(x) ? BG : FG }]}>{x.name}</Text>
            </Pressable>
          ))}
          <Btn label="⏹ Everyone stop" color="#FF5252" onPress={() => send({ type: 'cue', id: cueId(), seat: 0, action: 'all_out' })} />
        </View>
      ) : (
        // Tapping while pointing cues too, as a fallback for flicks that don't register.
        <Pressable style={styles.stage} onPress={() => cue(sel.current)}>
          <BeatRing color={p?.color ?? '#444'} />
          {p ? (
            <>
              <Text style={[styles.huge, { color: p.color }]}>{p.seat}</Text>
              <H1 color={p.color}>{p.name}</H1>
              <P color={FG}>
                {instrumentInfo(p.instrument).emoji} {isLive(p) ? `playing · ${state.live[p.seat]}%` : 'silent'}
              </P>
            </>
          ) : (
            <P>Point at a player</P>
          )}
        </Pressable>
      )}

      <View style={styles.liveRow}>
        {players.map((x) => (
          <View key={x.seat} style={[styles.dot, { backgroundColor: isLive(x) ? x.color : 'transparent', borderColor: x.color }]}>
            <Text style={{ color: isLive(x) ? BG : x.color, fontWeight: '900' }}>{x.seat}</Text>
          </View>
        ))}
      </View>
      {!buttons && <P>Flick to cue in/out · tilt for volume · point down and hold to stop all</P>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  huge: { fontSize: 140, fontWeight: '900', textAlign: 'center', color: FG },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerText: { color: FG, fontSize: 22, fontWeight: '900' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  buttons: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignContent: 'center' },
  cueBtn: { width: '47%', aspectRatio: 1.2, borderWidth: 4, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cueSeat: { fontSize: 48, fontWeight: '900' },
  cueName: { fontSize: 16, fontWeight: '700' },
  liveRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  dot: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
});
