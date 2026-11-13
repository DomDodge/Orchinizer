// Phone audio is Preview only (the TV plays the show), so keep it quiet.
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { keyRoot, SCALE, type Voice } from './protocol';
import { SOUNDS } from './sounds.gen';

const PREVIEW_VOLUME = 0.5;
const players = new Map<number, AudioPlayer>();

function player(source: number) {
  let p = players.get(source);
  if (!p) {
    p = createAudioPlayer(source);
    p.volume = PREVIEW_VOLUME;
    players.set(source, p);
  }
  return p;
}

function sourceFor(inst: Voice, key: string, row: number) {
  if (inst === 'drums') return SOUNDS.drums[row];
  const semitone = keyRoot(key) + SCALE[row];
  return SOUNDS[inst][semitone >= SOUNDS[inst].length ? semitone - 12 : semitone];
}

/** Create the players for an instrument up front so the first tap isn't late. */
export function preload(inst: Voice, key: string) {
  const rows = inst === 'drums' ? 3 : SCALE.length;
  for (let r = 0; r < rows; r++) player(sourceFor(inst, key, r));
}

/** Pending stops from playNoteFor, by sound, so a replay of the same sound isn't cut short. */
const stops = new Map<number, ReturnType<typeof setTimeout>>();

/** Play a note for `ms` milliseconds, then stop it (a stretched note). Samples shorter than that end early. */
export function playNoteFor(inst: Voice, key: string, row: number, ms: number) {
  const src = sourceFor(inst, key, row);
  if (src == null) return;
  playNote(inst, key, row);
  if (inst === 'drums') return; // hits ring out on their own
  stops.set(src, setTimeout(() => {
    stops.delete(src);
    player(src).pause();
  }, ms));
}

export function playNote(inst: Voice, key: string, row: number) {
  const src = sourceFor(inst, key, row);
  if (src == null) return;
  const pending = stops.get(src);
  if (pending) {
    clearTimeout(pending);
    stops.delete(src);
  }
  const p = player(src);
  p.shouldCorrectPitch = false;
  p.setPlaybackRate(inst !== 'drums' && keyRoot(key) + SCALE[row] >= 19 ? 2 : 1);
  p.seekTo(0);
  p.play();
}
