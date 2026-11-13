// Phone audio is Preview only (the TV plays the show), so keep it quiet.
// Each instrument has its own samples (scripts/gen-sounds.mjs), voiced like its TV synth.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { instrumentInfo, keyRoot, SCALE } from './protocol';
import { SAMPLE_STEP, SOUNDS } from './sounds.gen';

const PREVIEW_VOLUME = 0.5;

const isKit = (instrument: string) => instrumentInfo(instrument).voice === 'drums';

type Sound = { id: string; source: number; rate: number };

/**
 * The bundled sample for a row and the playback rate that tunes it. Tonal samples are SAMPLE_STEP
 * semitones apart, so the rate stays within a few semitones of 1. Unknown instruments use the piano.
 */
function soundFor(instrument: string, key: string, row: number): Sound | null {
  const bank = SOUNDS[instrument] ?? SOUNDS.piano;
  if (isKit(instrument)) {
    const source = bank[row];
    return source == null ? null : { id: `${instrument}:${row}`, source, rate: 1 };
  }
  const semitone = keyRoot(key) + SCALE[row];
  const i = Math.min(bank.length - 1, Math.floor(semitone / SAMPLE_STEP));
  return { id: `${instrument}:${semitone}`, source: bank[i], rate: 2 ** ((semitone - i * SAMPLE_STEP) / 12) };
}

// One player per pitch, so two rows tuned from the same sample can sound together.
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
export function preload(instrument: string, key: string) {
  ensureAudioMode();
  const rows = isKit(instrument) ? 3 : SCALE.length;
  for (let r = 0; r < rows; r++) {
    const s = soundFor(instrument, key, r);
    if (s) player(s);
  }
}

/** Pending stops from playNoteFor, by sound, so a replay of the same sound isn't cut short. */
const stops = new Map<string, ReturnType<typeof setTimeout>>();

/** Play a note for `ms` milliseconds, then stop it (a stretched note). Samples shorter than that end early. */
export function playNoteFor(instrument: string, key: string, row: number, ms: number) {
  const s = soundFor(instrument, key, row);
  if (!s) return;
  playNote(instrument, key, row);
  if (isKit(instrument)) return; // hits ring out on their own
  stops.set(s.id, setTimeout(() => {
    stops.delete(s.id);
    player(s).pause();
  }, ms));
}

export function playNote(instrument: string, key: string, row: number) {
  const s = soundFor(instrument, key, row);
  if (!s) return;
  ensureAudioMode();
  const pending = stops.get(s.id);
  if (pending) {
    clearTimeout(pending);
    stops.delete(s.id);
  }
  const p = player(s);
  p.shouldCorrectPitch = false;
  p.playbackRate = s.rate;
  p.seekTo(0);
  p.play();
}
