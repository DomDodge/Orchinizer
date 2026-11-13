// Phone Orchestra message schema. Mirrors messages.go field for field.
// Change both together and announce it in the group chat.

export type Role = "tv" | "player";
export type Phase = "lobby" | "compose" | "calibrate" | "perform" | "vote" | "results";
export type CueAction = "in" | "out";
export type HostActionKind = "start" | "next" | "skip" | "restart";
export type ErrorCode =
  | "bad_message"
  | "room_not_found"
  | "room_full"
  | "game_in_progress"
  | "not_allowed";

export const ROWS = 5;
export const STEPS = 8;
/** grid[row][step]. Row 0 is the lowest note of the round's scale. 5 x 8. */
export type Grid = boolean[][];

interface Base {
  room?: string;
}

/** First message on every connection. TV with no room creates one. */
export interface Join extends Base {
  type: "join";
  role: Role;
  name?: string;
  /** From a previous welcome: reconnect and take back your seat. */
  token?: string;
}

/** Reply to join. Store the token for reconnecting. TV gets seat 0. */
export interface Welcome extends Base {
  type: "welcome";
  role: Role;
  seat: number;
  color?: string;
  token: string;
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
  instrument: string; // dealt at join; a pattern message can change it
  connected: boolean;
  bot: boolean;
  noteCount: number;
  playing: boolean;
  voted: boolean;
}

export interface PerformanceSummary {
  round: number;
  conductorSeat: number;
  conductorName: string;
  votes: number;
}

/** Full game state, broadcast on every change. */
export interface State extends Base {
  type: "state";
  phase: Phase;
  round: number; // 1-based, 0 in the lobby
  totalRounds: number;
  conductor: number; // seat, 0 = none
  deadline: number; // Unix ms, 0 = none
  key: string; // tonic, e.g. "C"
  scale: string; // "major_pentatonic"
  tempo: number; // BPM
  instruments: string[];
  players: PlayerState[];
  performances: PerformanceSummary[] | null;
  winner: number; // winning round, 0 = none
}

export interface Pattern extends Base {
  type: "pattern";
  instrument: string;
  steps: Grid;
}

export interface Part {
  seat: number;
  instrument: string;
  steps: Grid;
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

export interface Vote extends Base {
  type: "vote";
  round: number;
}

export interface HostAction extends Base {
  type: "host_action";
  action: HostActionKind;
}

export interface LoggedCue {
  id: string;
  seat: number;
  action: CueAction;
  beat: number;
}

export interface Performance {
  round: number;
  conductorSeat: number;
  conductorName: string;
  key: string;
  tempo: number;
  parts: Part[];
  cues: LoggedCue[];
}

/** To the TV when the vote starts: everything needed for replays. */
export interface Performances extends Base {
  type: "performances";
  list: Performance[];
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
  | Performances;

export type ClientMessage =
  | Join
  | Pattern
  | Calibrated
  | Select
  | Cue
  | Volume
  | CueScheduled
  | Bar
  | Vote
  | HostAction;

/** Shared constants. The server is the source of truth; these are for display and dev. */
export const INSTRUMENT_GROUPS: Record<string, string[]> = {
  strings: ["contrabass", "cello", "viola", "violin"],
};
export const SEAT_COLORS = [
  "#e6194b", "#3cb44b", "#ffe119", "#4363d8",
  "#f58231", "#911eb4", "#42d4f4", "#f032e6",
];
/** Major pentatonic scale degrees as semitones above the tonic; row 0 = index 0. */
export const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];
