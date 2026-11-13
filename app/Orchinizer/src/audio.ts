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

const sourceFor = (inst: Voice, key: string, row: number) =>
  inst === 'drums' ? SOUNDS.drums[row] : SOUNDS[inst][keyRoot(key) + SCALE[row]];

/** Create the players for an instrument up front so the first tap isn't late. */
export function preload(inst: Voice, key: string) {
  const rows = inst === 'drums' ? 3 : SCALE.length;
  for (let r = 0; r < rows; r++) player(sourceFor(inst, key, r));
}

export function playNote(inst: Voice, key: string, row: number) {
  const src = sourceFor(inst, key, row);
  if (src == null) return;
  const p = player(src);
  p.seekTo(0);
  p.play();
}
