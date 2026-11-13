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

export function playNote(inst: Voice, key: string, row: number) {
  const src = sourceFor(inst, key, row);
  if (src == null) return;
  const p = player(src);
  p.shouldCorrectPitch = false;
  p.playbackRate = inst !== 'drums' && keyRoot(key) + SCALE[row] >= 19 ? 2 : 1;
  p.seekTo(0);
  p.play();
}
