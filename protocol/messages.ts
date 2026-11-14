// Phone Orchestra message schema. Mirrors messages.go field for field.
// Change both together and announce it in the group chat.

export type Role = "tv" | "player";
export type Phase = "lobby" | "compose" | "calibrate" | "perform" | "results";
export type CueAction = "in" | "out";
export type HostActionKind = "start" | "next" | "skip" | "restart";
export type ErrorCode =
  | "bad_message"
  | "room_not_found"
  | "room_full"
  | "game_in_progress"
  | "not_allowed"
  | "bad_pattern";

export const ROWS = 5;
export const STEPS = 8;
/** grid[row][step]. Row 0 is the lowest note of the round's scale. 5 x 8. */
export type Grid = boolean[][];

interface Base {
  room?: string;
}

/** First message. A TV or named player without room creates one. */
export interface Join extends Base {
  type: "join";
  role: Role;
  name?: string;
  /** From a previous welcome: reconnect and take back your seat. */
  token?: string;
}

/**
 * Reply to join. Store the token for reconnecting. TV gets seat 0.
 * Players also get their current part, so a reconnecting phone can restore its sequencer.
 */
export interface Welcome extends Base {
  type: "welcome";
  role: Role;
  seat: number;
  color?: string;
  token: string;
  instrument?: string;
  steps?: Grid;
  /** The note-editor part, if the phone sent one. */
  notes?: Note[];
}

export interface ErrorMsg extends Base {
  type: "error";
  code: ErrorCode;
  message: string;
}

export interface PlayerState {
  seat: number; // 1-based
  name: string;
  color: string; // "#rrggbb"
  instrument: string; // picked in lobby; empty while conducting
  connected: boolean;
  bot: boolean;
  noteCount: number;
  playing: boolean;
}

export interface PerformanceSummary {
  round: number;
  conductorSeat: number;
  conductorName: string;
  key: string;
  tempo: number;
  score?: ScoreSummary;
}

export interface ScoreSummary {
  points: number;
  maxCombo: number;
  perfect: number;
  good: number;
  misses: number;
  total: number;
}

interface CueTargetBase {
  id: number;
  seat: number;
  at: number; // server Unix milliseconds; score the gesture, before TV quantization
  result: 'pending' | 'perfect' | 'good' | 'miss';
}
/** A prompt on the conductor's chart. `kind` is the gesture it wants (see README "Note types"). */
export type CueTarget =
  | (CueTargetBase & { kind: 'flick'; action: CueAction })
  | (CueTargetBase & { kind: 'hold'; end: number }); // keep pointing at seat from at to end

export interface RoundScoring {
  summary: ScoreSummary;
  combo: number;
  targets: CueTarget[];
  last?: { targetId: number; result: 'perfect' | 'good' | 'miss' | 'early'; points: number; at: number };
}

export const SCORE_HIT_WINDOW_MS = 300;
export const HOLD_PERFECT_SHARE = 0.9;
export const HOLD_GOOD_SHARE = 0.6;

/** Full game state, broadcast on every change. */
export interface State extends Base {
  type: "state";
  phase: Phase;
  round: number; // 1-based, 0 in the lobby
  totalRounds: number;
  conductor: number; // seat, 0 = none
  deadline: number; // Unix ms, 0 = none
  /**
   * Unix ms when the server sent this state. Count down with
   * deadline - serverTime - (Date.now() - receivedAt), so a phone's wrong clock doesn't matter.
   */
  serverTime: number;
  key: string; // tonic, e.g. "C"
  scale: string; // "major_pentatonic"
  tempo: number; // BPM
  instruments: string[];
  players: PlayerState[];
  performances: PerformanceSummary[];
  host: number;
  tvConnected: boolean;
  categories: Category[];
  patterns: Record<string, Grid>;
  /** Note-editor parts by seat. Seats without notes are left out. */
  notes?: Record<string, Note[]>;
  live: Record<string, number>;
  winner: number; // round with the most points (ties go to the earlier round), 0 = none
  scoring?: RoundScoring;
}

/** A phone using the note editor sends notes; the grid sequencer sends steps. Each message replaces the whole part. */
export interface Pattern extends Base {
  type: "pattern";
  instrument?: string;
  /** Optional when sending notes. A missing grid is read as empty. */
  steps?: Grid;
  notes?: Note[];
}

export interface Part {
  seat: number;
  instrument: string;
  steps: Grid;
  notes?: Note[];
}

/** To the TV on every pattern change, and once more with locked=true. */
export interface Patterns extends Base {
  type: "patterns";
  round: number;
  key: string;
  tempo: number;
  parts: Part[];
  locked: boolean;
}

/** Angles in degrees relative to seat 1, keyed by seat (JSON keys are strings). */
export interface Calibrated extends Base {
  type: "calibrated";
  angles: Record<string, number>;
}

export interface Select extends Base {
  type: "select";
  seat: number;
}

export interface Cue extends Base {
  type: "cue";
  id: string;
  seat: number;
  action: CueAction;
}

export interface Volume extends Base {
  type: "volume";
  seat: number;
  level: number; // 0-100
}

/** TV -> server: the beat a cue actually played on. Beat 0 = transport start. */
export interface CueScheduled extends Base {
  type: "cue_scheduled";
  id: string;
  seat: number;
  action: CueAction;
  beat: number;
}

export interface Bar extends Base {
  type: "bar";
  bar: number;
  tempo: number;
}

export interface HostAction extends Base {
  type: "host_action";
  action: HostActionKind;
}

export type ServerMessage =
  | Welcome
  | ErrorMsg
  | State
  | Patterns
  | Calibrated
  | Select
  | Cue
  | Volume
  | Bar
  | Kicked;

export type ClientMessage =
  | Join
  | Pattern
  | Calibrated
  | Select
  | Cue
  | Volume
  | CueScheduled
  | Bar
  | HostAction
  | AllOut
  | Categories
  | Pick
  | Leave
  | Kick;

/** GET https://<host>/config (plain HTTP JSON): what the TV's QR code should open. */
export interface ServerConfig {
  expoUrl: string; // "" if the server's EXPO_URL isn't set
}

/** Shared constants. The server is the source of truth; these are for display and dev. */
export type Category = "strings" | "wind" | "percussion" | "keys";
export interface AllOut extends Base { type: "cue"; id: string; seat: 0; action: "all_out" }
export interface Categories extends Base { type: "categories"; categories: Category[] }
export interface Pick extends Base { type: "pick"; instrument: string | null }
export interface Leave extends Base { type: "leave" }
export interface Kick extends Base { type: "kick"; seat: number }
export interface Kicked extends Base { type: "kicked" }
export const INSTRUMENT_GROUPS: Record<Category, string[]> = {
  strings: ["contrabass", "cello", "viola", "violin", "harp", "guitar"],
  wind: ["flute", "clarinet", "sax", "trumpet", "trombone", "tuba"],
  percussion: ["drums", "timpani", "xylophone", "bongos"],
  keys: ["piano", "organ", "synth"],
};
export const SEAT_COLORS = [
  "#e6194b", "#3cb44b", "#ffe119", "#4363d8",
  "#f58231", "#911eb4", "#42d4f4", "#f032e6",
];
/** Major pentatonic scale degrees as semitones above the tonic; row 0 = index 0. */
export const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];

// NOTATION ADDITIONS
export const STEPS_PER_BEAT = 4;  // 16th notes
export const LOOP_STEPS = 256;    // 16 bars: the shared song everyone composes on
export const MAX_NOTES = 16;      // per player
export const MAX_NOTE_STEPS = 8;  // longest note: half a bar
export const MIN_GAP_STEPS = 1;   // rest between consecutive notes on the sheet (any players)

export interface Note {
  id: string;
  row: number;     // 0 = lowest note in the scale
  start: number;   // step
  length: number;  // steps
  instrument?: string;
}
