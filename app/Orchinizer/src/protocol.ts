// Use the same wire contract as the Go server and the TV.
import type { Grid as Steps } from '../../../protocol/messages.ts';
import { ROWS, STEPS, MAJOR_PENTATONIC as SCALE } from '../../../protocol/messages.ts';
export type { Phase, State, Grid as Steps, PlayerState as Player, PerformanceSummary as Performance,
  ServerMessage as ServerMsg, ClientMessage as ClientMsg } from '../../../protocol/messages.ts';
export { ROWS, STEPS, MAJOR_PENTATONIC as SCALE } from '../../../protocol/messages.ts';
export type Voice = 'bass' | 'pad' | 'lead' | 'drums';

export const DRUM_ROWS = ['Kick', 'Snare', 'Hat'];

export const CATEGORIES = {
  strings: { label: 'Strings', emoji: '🎻' },
  wind: { label: 'Wind', emoji: '🎺' },
  percussion: { label: 'Percussion', emoji: '🥁' },
  keys: { label: 'Keys', emoji: '🎹' },
} as const;
export type Category = keyof typeof CATEGORIES;
export const ALL_CATEGORIES = Object.keys(CATEGORIES) as Category[];

type InstrumentInfo = { label: string; emoji: string; category: Category; voice: Voice };
const i = (label: string, emoji: string, category: Category, voice: Voice): InstrumentInfo => ({ label, emoji, category, voice });
export const INSTRUMENTS: Record<string, InstrumentInfo> = {
  violin: i('Violin', '🎻', 'strings', 'lead'),
  viola: i('Viola', '🎻', 'strings', 'pad'),
  cello: i('Cello', '🎻', 'strings', 'bass'),
  contrabass: i('Double bass', '🎻', 'strings', 'bass'),
  harp: i('Harp', '🎶', 'strings', 'lead'),
  guitar: i('Guitar', '🎸', 'strings', 'lead'),
  flute: i('Flute', '🪈', 'wind', 'lead'),
  clarinet: i('Clarinet', '🎷', 'wind', 'lead'),
  sax: i('Sax', '🎷', 'wind', 'lead'),
  trumpet: i('Trumpet', '🎺', 'wind', 'lead'),
  trombone: i('Trombone', '🎺', 'wind', 'bass'),
  tuba: i('Tuba', '🎺', 'wind', 'bass'),
  drums: i('Drums', '🥁', 'percussion', 'drums'),
  timpani: i('Timpani', '🥁', 'percussion', 'drums'),
  xylophone: i('Xylophone', '🎼', 'percussion', 'lead'),
  bongos: i('Bongos', '🪘', 'percussion', 'drums'),
  piano: i('Piano', '🎹', 'keys', 'lead'),
  organ: i('Organ', '🎹', 'keys', 'pad'),
  synth: i('Synth', '🎛️', 'keys', 'pad'),
};
export const instrumentInfo = (id: string): InstrumentInfo => INSTRUMENTS[id] ?? i('Instrument', '🎵', 'keys', 'lead');

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const keyRoot = (key: string) => Math.max(0, NOTE_NAMES.indexOf(({ Bb: 'A#', Eb: 'D#', Ab: 'G#', Db: 'C#', Gb: 'F#' } as Record<string, string>)[key] ?? key));
export const noteName = (key: string, row: number) => NOTE_NAMES[(keyRoot(key) + SCALE[row]) % 12];

export const emptySteps = (): Steps => Array.from({ length: ROWS }, () => Array(STEPS).fill(false));
