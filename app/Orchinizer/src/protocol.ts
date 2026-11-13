// Frontend message types. Align with the repository's shared protocol during backend integration.

export type Phase = 'lobby' | 'compose' | 'calibrate' | 'perform' | 'vote' | 'results';
/** Synth voice an instrument previews with on the phone. */
export type Voice = 'bass' | 'pad' | 'lead' | 'drums';
export type Steps = boolean[][]; // [row][step], 5 × 8

export type Player = {
  seat: number;
  name: string;
  color: string;
  instrument: string; // '' until picked in the lobby
  online: boolean;
  bot: boolean;
  notes: number;
};

export type Performance = {
  round: number;
  conductor: number;
  name: string;
  key: string;
  tempo: number;
  votes: number;
};

export type State = {
  type: 'state';
  room: string;
  phase: Phase;
  round: number;
  rounds: number;
  conductor: number;
  key: string;
  tempo: number;
  deadline: number;
  serverNow: number;
  players: Player[];
  patterns: Record<string, Steps>;
  live: Record<string, number>;
  performances: Performance[];
  winner: number;
  categories: Category[]; // enabled by the round-1 conductor in the lobby
};

export type ServerMsg =
  | State
  | { type: 'welcome'; room: string; seat: number }
  | { type: 'bar'; bar: number; tempo: number }
  | { type: 'error'; msg: string }
  | { type: 'kicked' };

export type ClientMsg =
  | { type: 'join'; role: 'player'; id: string; name: string; room?: string } // no room = host a new one
  | { type: 'categories'; categories: Category[] }
  | { type: 'pick'; instrument: string | null }
  | { type: 'leave' }
  | { type: 'kick'; seat: number } // round-1 conductor removes a player (e.g. one that went offline)
  | { type: 'pattern'; steps: Steps }
  | { type: 'calibrated'; angles: Record<string, number> }
  | { type: 'select'; seat: number }
  | { type: 'cue'; id: string; seat: number; action: 'in' | 'out' | 'all_out' }
  | { type: 'volume'; seat: number; level: number }
  | { type: 'vote'; round: number };

export const ROWS = 5;
export const STEPS = 8;
export const SCALE = [0, 2, 4, 7, 9]; // major pentatonic semitones above the key
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
  bass: i('Double bass', '🎻', 'strings', 'bass'),
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
export const keyRoot = (key: string) => Math.max(0, NOTE_NAMES.indexOf(key));
export const noteName = (key: string, row: number) => NOTE_NAMES[(keyRoot(key) + SCALE[row]) % 12];

export const emptySteps = (): Steps => Array.from({ length: ROWS }, () => Array(STEPS).fill(false));
