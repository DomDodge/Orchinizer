import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createBaton } from '../aim';
import { clearCalibration, getCalibration } from '../calibration';
import { send, useSecondsLeft } from '../net';
import { motionSupported, onSample } from '../pointer';
import { instrumentInfo, type Player, type State } from '../protocol';
import { BeatRing } from './Pulse';
import { BG, Btn, FG, H1, P, Screen, Timer } from './ui';

const band = (s: State) => s.players.filter((p) => p.instrument && p.seat !== s.conductor);
let cueN = 0;
const cueId = () => `${Date.now().toString(36)}-${cueN++}`;

/** Perform phase: point + flick to toggle parts, tilt for volume, point down and hold for the big finish. */
export function Perform({ state }: { state: State }) {
  const left = useSecondsLeft(state.deadline);
  const [selected, setSelected] = useState(0);
  const [directions] = useState(() => getCalibration(state));
  const [buttons, setButtons] = useState(!motionSupported || directions.length === 0);
  useEffect(() => () => clearCalibration(), []);
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
    const baton = createBaton(directions);
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
  }, [buttons, directions]);

  // Score: the server grades each cue against the cue chart the TV shows.
  const targets = state.targets ?? [];
  const score = targets.reduce((sum, t) => sum + t.points, 0);
  const hits = targets.filter((t) => t.grade === 'perfect' || t.grade === 'good');
  const lastHit = hits.reduce<(typeof hits)[number] | undefined>((a, t) => (!a || t.beat > a.beat ? t : a), undefined);
  const seenHits = useRef(hits.length);
  useEffect(() => {
    if (hits.length > seenHits.current) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    seenHits.current = hits.length;
  }, [hits.length]);

  const players = band(state);
  const p = players.find((x) => x.seat === selected);
  const isLive = (x: Player) => state.live[x.seat] != null;

  return (
    <Screen bg={p ? p.color + '33' : BG}>
      {/* Long-press the header for the hidden fallback: on-screen cue buttons. */}
      <Pressable onLongPress={() => setButtons(!buttons)} style={styles.header}>
        <Text style={styles.headerText}>🎼 Conducting</Text>
        <Text style={styles.score}>{score} pts</Text>
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
      {lastHit && (
        <Text key={lastHit.beat} style={[styles.grade, { color: lastHit.grade === 'perfect' ? '#F2C14E' : FG }]}>
          {lastHit.grade === 'perfect' ? 'Perfect!' : 'Good'} +{lastHit.points}
        </Text>
      )}
      {!buttons && <P>Cue each seat as its gold bar lands on the TV · flick to cue in/out · tilt for volume · point down and hold to stop all</P>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  huge: { fontSize: 140, fontWeight: '900', textAlign: 'center', color: FG },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerText: { color: FG, fontSize: 22, fontWeight: '900' },
  score: { color: '#F2C14E', fontSize: 22, fontWeight: '900' },
  grade: { fontSize: 28, fontWeight: '900', textAlign: 'center' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  buttons: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignContent: 'center' },
  cueBtn: { width: '47%', aspectRatio: 1.2, borderWidth: 4, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cueSeat: { fontSize: 48, fontWeight: '900' },
  cueName: { fontSize: 16, fontWeight: '700' },
  liveRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  dot: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
});
