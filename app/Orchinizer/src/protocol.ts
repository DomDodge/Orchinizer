// Use the same wire contract as the Go server and the TV.
import type { Grid as Steps } from '../../../protocol/messages.ts';
import { ROWS, STEPS, MAJOR_PENTATONIC as SCALE } from '../../../protocol/messages.ts';
export type { Phase, State, Grid as Steps, PlayerState as Player, PerformanceSummary as Performance,
  ServerMessage as ServerMsg, ClientMessage as ClientMsg, RoundScoring, ScoreSummary } from '../../../protocol/messages.ts';
export { ROWS, STEPS, NOTE_ROWS, MAJOR_PENTATONIC as SCALE } from '../../../protocol/messages.ts';
export type Voice = 'bass' | 'pad' | 'lead';

export const CATEGORIES = {
  strings: { label: 'Strings', emoji: '🎻' },
  wind: { label: 'Wind', emoji: '🎺' },
  keys: { label: 'Keys', emoji: '🎹' },
} as const;
export type Category = keyof typeof CATEGORIES;
export const ALL_CATEGORIES = Object.keys(CATEGORIES) as Category[];

/** `octave`: the octave of the instrument's lowest note, its row 0 (a C), in scientific pitch (middle C = C4). */
type InstrumentInfo = { label: string; emoji: string; category: Category; voice: Voice; octave: number };
const i = (label: string, emoji: string, category: Category, voice: Voice, octave: number): InstrumentInfo => ({ label, emoji, category, voice, octave });
export const INSTRUMENTS: Record<string, InstrumentInfo> = {
  violin: i('Violin', '🎻', 'strings', 'lead', 5),
  viola: i('Viola', '🎻', 'strings', 'pad', 4),
  cello: i('Cello', '🎻', 'strings', 'bass', 3),
  contrabass: i('Double bass', '🎻', 'strings', 'bass', 2),
  guitar: i('Guitar', '🎸', 'strings', 'lead', 3),
  flute: i('Flute', '🪈', 'wind', 'lead', 5),
  clarinet: i('Clarinet', '🎷', 'wind', 'lead', 4),
  sax: i('Sax', '🎷', 'wind', 'lead', 4),
  trumpet: i('Trumpet', '🎺', 'wind', 'lead', 4),
  trombone: i('Trombone', '🎺', 'wind', 'bass', 3),
  tuba: i('Tuba', '🎺', 'wind', 'bass', 2),
  piano: i('Piano', '🎹', 'keys', 'lead', 4),
  organ: i('Organ', '🎹', 'keys', 'pad', 3),
  synth: i('Synth', '🎛️', 'keys', 'pad', 4),
};
export const instrumentInfo = (id: string): InstrumentInfo => INSTRUMENTS[id] ?? i('Instrument', '🎵', 'keys', 'lead', 4);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const keyRoot = (key: string) => Math.max(0, NOTE_NAMES.indexOf(({ Bb: 'A#', Eb: 'D#', Ab: 'G#', Db: 'C#', Gb: 'F#' } as Record<string, string>)[key] ?? key));
/** The note name of a note-editor row (chromatic from C), e.g. row 13 = 'C#'. */
export const rowName = (row: number) => NOTE_NAMES[row % 12];
/** Row's note with its octave on this instrument, e.g. violin row 13 = 'C#6'. */
export const noteLabel = (instrument: string, row: number) => `${rowName(row)}${instrumentInfo(instrument).octave + Math.floor(row / 12)}`;
/** Whether a row is a sharp (a black key), for shading the editor like a keyboard. */
export const isSharp = (row: number) => rowName(row).endsWith('#');
/** Whether a row is in `key`'s major pentatonic scale, the notes that always sound good together. */
export const inKey = (key: string, row: number) => SCALE.includes((((row - keyRoot(key)) % 12) + 12) % 12);

export const emptySteps = (): Steps => Array.from({ length: ROWS }, () => Array(STEPS).fill(false));
