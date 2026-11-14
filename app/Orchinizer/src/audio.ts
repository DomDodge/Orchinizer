// Phone audio is Preview only (the TV plays the show), so keep it quiet.
// Every instrument has a recording of each note-editor row (scripts/import-sounds.mjs), so each
// note plays its own file at its recorded pitch.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { NOTE_ROWS } from './protocol';
import { SOUNDS } from './sounds.gen';

const PREVIEW_VOLUME = 0.5;

type Sound = { id: string; source: number };

/** The recording for a row (semitones above the instrument's C). Unknown instruments use the piano. */
function soundFor(instrument: string, row: number): Sound | null {
  const id = SOUNDS[instrument] ? instrument : 'piano';
  const source = SOUNDS[id]?.[row];
  return source == null ? null : { id: `${id}:${row}`, source };
}

// One player per note, so different notes can sound together.
const players = new Map<string, AudioPlayer>();

function player(sound: Sound) {
  let p = players.get(sound.id);
  if (!p) {
    p = createAudioPlayer(sound.source);
    p.volume = PREVIEW_VOLUME;
    players.set(sound.id, p);
  }
  return p;
}

let audioModeSet = false;
/** Play previews even with the ring/silent switch on, alongside any music already playing. */
function ensureAudioMode() {
  if (audioModeSet) return;
  audioModeSet = true;
  setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {
    audioModeSet = false;
  });
}

/** Create the players for an instrument up front so the first tap isn't late. */
export function preload(instrument: string) {
  ensureAudioMode();
  for (let r = 0; r < NOTE_ROWS; r++) {
    const s = soundFor(instrument, r);
    if (s) player(s);
  }
}

/** Pending stops from playNoteFor, by sound, so a replay of the same sound isn't cut short. */
const stops = new Map<string, ReturnType<typeof setTimeout>>();

/** Play a note for `ms` milliseconds, then stop it (a stretched note). Recordings shorter than that end early. */
export function playNoteFor(instrument: string, row: number, ms: number) {
  const s = soundFor(instrument, row);
  if (!s) return;
  playNote(instrument, row);
  stops.set(s.id, setTimeout(() => {
    stops.delete(s.id);
    player(s).pause();
  }, ms));
}

export function playNote(instrument: string, row: number) {
  const s = soundFor(instrument, row);
  if (!s) return;
  ensureAudioMode();
  const pending = stops.get(s.id);
  if (pending) {
    clearTimeout(pending);
    stops.delete(s.id);
  }
  const p = player(s);
  // Never set p.playbackRate: on iOS (Expo Go, SDK 58) setting a non-integer rate hangs the app.
  // There's no need: every note has its own recording.
  p.seekTo(0);
  p.play();
}
