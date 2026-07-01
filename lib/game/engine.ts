// Foosball physics engine. Pure module: no DOM, no React, no network.
// The HOST runs stepHost() each frame; the GUEST never simulates the ball — it
// just renders interpolated state received from the host (see lib/realtime/room.ts).
//
// Coordinate system: a fixed logical playfield FIELD.W x FIELD.H (the renderer
// scales it to the canvas). Blue defends the LEFT goal and attacks right (+x);
// red defends the RIGHT goal and attacks left (-x). All of one color's rods slide
// together on a single y-axis "offset" (the chosen one-axis control scheme).

export type Side = "blue" | "red";
export type Phase = "lobby" | "countdown" | "playing" | "goal" | "matchover";

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface GameState {
  ball: Ball;
  blueOffset: number;
  redOffset: number;
  blueTarget: number;
  redTarget: number;
  blueVel: number; // offset velocity, transferred to the ball as "english"
  redVel: number;
  blueKick: number; // seconds of kick power remaining
  redKick: number;
  blueKickDir: number; // +1 kicks the ball right, -1 left (set by the player)
  redKickDir: number;
  blueSwing: number; // -1..1 visual foot swing (eased), for the kick animation
  redSwing: number;
  shakeCd: number; // cooldown (s) before the table can be shaken again
  // Freeze power-up (Mario-Kart-style ice cube).
  powerups: boolean; // is the freeze power-up enabled for this match?
  lastTouch: Side | null; // who last struck the ball (decides who a cube freezes)
  cubeActive: boolean; // is an ice cube currently on the table?
  cubeX: number;
  cubeY: number;
  cubeTimer: number; // seconds until the next cube spawns (while none is active)
  blueFrozen: number; // seconds blue's rods are frozen
  redFrozen: number;
  freezes: number; // event counter for sound/banner
  scoreBlue: number;
  scoreRed: number;
  phase: Phase;
  phaseTimer: number;
  winner: Side | null;
  lastScorer: Side | null;
  trail: { x: number; y: number }[];
  // Monotonic event counters the renderer/UI watches to fire sound + shake.
  // (Keeps the engine pure — no callbacks — while still surfacing collisions.)
  hits: number;
  walls: number;
  goals: number;
}

export const FIELD = {
  W: 1000,
  H: 600,
  R: 11, // ball radius
  HW: 9, // man half-width (rod thickness that blocks)
  MH: 32, // man half-height
  O_MAX: 80, // max rod offset from center (keeps all men in bounds)
  GOAL_HALF: 95, // half-height of the goal mouth
  WALL_PAD: 6,
} as const;

const WIN_SCORE = 5;
const SERVE_SPEED = 340;
const KICK_SPEED = 760;
const MAX_SPEED = 920;
const RESTITUTION = 0.72; // ball bounce off a blocking man
const WALL_REST = 0.82;
const MIN_BOUNCE = 240; // floor on horizontal speed after a block, so it never stalls
const ENGLISH = 0.42; // how much a sliding man's velocity transfers to the ball
const SPREAD = 3; // vertical kick based on where the ball hit the man
const DRAG = 0.16; // gentle per-second velocity decay (lower = fewer dead stops)
const SHAKE_IMPULSE = 330; // velocity a table-shake imparts to the ball
const SHAKE_CD = 0.45; // min seconds between table shakes
const FREEZE_TIME = 1.5; // seconds a frozen player's rods are locked
export const CUBE_R = 17; // ice-cube collision/draw radius
const SPAWN_MIN = 14; // "rare surprise" spawn window (seconds)
const SPAWN_MAX = 26;

function nextSpawn() {
  return SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
}
const KICK_DURATION = 0.16;
export const KB_SPEED = 430; // keyboard rod-target speed (units/sec)
const EASE = 22; // how fast men ease toward their target offset
const SWING_EASE = 15; // how fast the kicking foot swings out and back
const COUNTDOWN_TIME = 1.6;
const GOAL_TIME = 1.7;
const TRAIL_MAX = 14;

export interface Rod {
  x: number;
  side: Side;
  dir: 1 | -1; // attacking direction
  men: number[]; // base y centers at offset 0
}

// Standard interleaved foosball layout, left to right.
export const RODS: Rod[] = [
  { x: 70, side: "blue", dir: 1, men: [300] }, // blue goalie
  { x: 175, side: "blue", dir: 1, men: [220, 380] }, // blue defense
  { x: 320, side: "red", dir: -1, men: [180, 300, 420] }, // red attack
  { x: 430, side: "blue", dir: 1, men: [120, 210, 300, 390, 480] }, // blue mid
  { x: 570, side: "red", dir: -1, men: [120, 210, 300, 390, 480] }, // red mid
  { x: 680, side: "blue", dir: 1, men: [180, 300, 420] }, // blue attack
  { x: 825, side: "red", dir: -1, men: [220, 380] }, // red defense
  { x: 930, side: "red", dir: -1, men: [300] }, // red goalie
];

export function createState(): GameState {
  return {
    ball: { x: FIELD.W / 2, y: FIELD.H / 2, vx: 0, vy: 0 },
    blueOffset: 0,
    redOffset: 0,
    blueTarget: 0,
    redTarget: 0,
    blueVel: 0,
    redVel: 0,
    blueKick: 0,
    redKick: 0,
    blueKickDir: 1,
    redKickDir: -1,
    blueSwing: 0,
    redSwing: 0,
    shakeCd: 0,
    powerups: false,
    lastTouch: null,
    cubeActive: false,
    cubeX: 0,
    cubeY: 0,
    cubeTimer: nextSpawn(),
    blueFrozen: 0,
    redFrozen: 0,
    freezes: 0,
    scoreBlue: 0,
    scoreRed: 0,
    phase: "lobby",
    phaseTimer: 0,
    winner: null,
    lastScorer: null,
    trail: [],
    hits: 0,
    walls: 0,
    goals: 0,
  };
}

function clampSpeed(b: Ball) {
  const s = Math.hypot(b.vx, b.vy);
  if (s > MAX_SPEED) {
    const k = MAX_SPEED / s;
    b.vx *= k;
    b.vy *= k;
  }
}

// Serve toward the side that just conceded (gives them a fair shot), else random.
export function serve(state: GameState, towardBlue: boolean) {
  const dir = towardBlue ? -1 : 1;
  const angle = (Math.random() - 0.5) * 0.7; // +/- ~20deg
  state.ball = {
    x: FIELD.W / 2,
    y: FIELD.H / 2,
    vx: dir * SERVE_SPEED * Math.cos(angle),
    vy: SERVE_SPEED * Math.sin(angle),
  };
  state.trail = [];
}

export function startMatch(state: GameState) {
  state.scoreBlue = 0;
  state.scoreRed = 0;
  state.winner = null;
  state.lastScorer = null;
  state.phase = "countdown";
  state.phaseTimer = COUNTDOWN_TIME;
  state.ball = { x: FIELD.W / 2, y: FIELD.H / 2, vx: 0, vy: 0 };
  state.trail = [];
  // Reset power-up state (but keep the powerups on/off setting).
  state.lastTouch = null;
  state.cubeActive = false;
  state.cubeTimer = nextSpawn();
  state.blueFrozen = 0;
  state.redFrozen = 0;
}

// dir: +1 drives the ball right, -1 left. Defaults to the side's attacking
// direction (blue -> right, red -> left) so a plain "kick" still goes forward.
// Shake the table: jolt the ball in a random direction to free a stuck/slow ball.
// Only acts during play and respects a short cooldown. Returns true if applied.
export function shakeTable(state: GameState): boolean {
  if (state.phase !== "playing" || state.shakeCd > 0) return false;
  state.shakeCd = SHAKE_CD;
  const ang = Math.random() * Math.PI * 2;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const cur = Math.hypot(state.ball.vx, state.ball.vy);
  if (cur < 220) {
    // Nearly stopped -> launch it cleanly in a random direction.
    state.ball.vx = cos * SHAKE_IMPULSE;
    state.ball.vy = sin * SHAKE_IMPULSE;
  } else {
    // Already moving -> just jostle it.
    state.ball.vx += cos * SHAKE_IMPULSE * 0.6;
    state.ball.vy += sin * SHAKE_IMPULSE * 0.6;
  }
  clampSpeed(state.ball);
  return true;
}

export function kick(state: GameState, side: Side, dir?: number) {
  if (side === "blue") {
    state.blueKick = KICK_DURATION;
    state.blueKickDir = dir ?? 1;
  } else {
    state.redKick = KICK_DURATION;
    state.redKickDir = dir ?? -1;
  }
}

// Simple AI for the RED side (single-player practice). Tracks the ball vertically
// with reaction-limited speed (slower than a human, so it's beatable) and clears
// the ball toward blue's goal when it's near one of red's rods.
const BOT_SPEED = 300; // rod tracking speed (units/sec) — player's is faster (430)
export function botControl(state: GameState, dt: number) {
  if (state.phase !== "playing" || state.redFrozen > 0) return;
  const b = state.ball;
  const desired = Math.max(-FIELD.O_MAX, Math.min(FIELD.O_MAX, b.y - FIELD.H / 2));
  const step = BOT_SPEED * dt;
  const delta = desired - state.redTarget;
  state.redTarget += Math.max(-step, Math.min(step, delta));
  if (state.redKick <= 0 && b.x > FIELD.W * 0.4) {
    for (const rod of RODS) {
      if (rod.side === "red" && Math.abs(b.x - rod.x) < 32) {
        kick(state, "red", -1);
        break;
      }
    }
  }
}

function inGoalMouth(y: number) {
  return y > FIELD.H / 2 - FIELD.GOAL_HALF && y < FIELD.H / 2 + FIELD.GOAL_HALF;
}

// Resolve ball vs a single rod's men. Mutates the ball. Returns true on contact.
function collideRod(b: Ball, rod: Rod, offset: number, sideVel: number, kickDir: number) {
  const { HW, MH, R } = FIELD;
  for (const baseY of rod.men) {
    const manY = baseY + offset;
    const left = rod.x - HW - R;
    const right = rod.x + HW + R;
    const top = manY - MH - R;
    const bot = manY + MH + R;
    if (b.x > left && b.x < right && b.y > top && b.y < bot) {
      const fromLeft = b.x < rod.x;
      // Push the ball out along x so it can't tunnel or stick.
      b.x = fromLeft ? rod.x - HW - R : rod.x + HW + R;
      if (kickDir !== 0) {
        b.vx = kickDir * KICK_SPEED;
      } else {
        const reflected = fromLeft ? -Math.abs(b.vx) : Math.abs(b.vx);
        b.vx = reflected * RESTITUTION;
        if (Math.abs(b.vx) < MIN_BOUNCE) b.vx = (fromLeft ? -1 : 1) * MIN_BOUNCE;
      }
      b.vy += sideVel * ENGLISH + (b.y - manY) * SPREAD;
      clampSpeed(b);
      return true;
    }
  }
  return false;
}

// Integrate one fixed sub-step of ball motion + collisions. Returns 'blue'|'red'
// if a goal was scored this sub-step (the side that SCORED), else null.
function substep(state: GameState, dt: number): Side | null {
  const b = state.ball;
  const drag = Math.max(0, 1 - DRAG * dt);
  b.vx *= drag;
  b.vy *= drag;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // Top / bottom walls.
  if (b.y < FIELD.R) {
    b.y = FIELD.R;
    b.vy = Math.abs(b.vy) * WALL_REST;
    state.walls++;
  } else if (b.y > FIELD.H - FIELD.R) {
    b.y = FIELD.H - FIELD.R;
    b.vy = -Math.abs(b.vy) * WALL_REST;
    state.walls++;
  }

  // Left wall / blue goal.
  if (b.x < FIELD.R) {
    if (inGoalMouth(b.y)) return "red"; // red scored on blue's goal
    b.x = FIELD.R;
    b.vx = Math.abs(b.vx) * WALL_REST;
  }
  // Right wall / red goal.
  if (b.x > FIELD.W - FIELD.R) {
    if (inGoalMouth(b.y)) return "blue"; // blue scored on red's goal
    b.x = FIELD.W - FIELD.R;
    b.vx = -Math.abs(b.vx) * WALL_REST;
  }

  // Men. Resolve at most one rod per sub-step to keep it stable.
  for (const rod of RODS) {
    const offset = rod.side === "blue" ? state.blueOffset : state.redOffset;
    const sideVel = rod.side === "blue" ? state.blueVel : state.redVel;
    const kickDir =
      rod.side === "blue"
        ? state.blueKick > 0
          ? state.blueKickDir
          : 0
        : state.redKick > 0
          ? state.redKickDir
          : 0;
    if (collideRod(b, rod, offset, sideVel, kickDir)) {
      state.hits++;
      state.lastTouch = rod.side;
      break;
    }
  }

  // Ice cube: whoever last touched the ball freezes their opponent.
  if (state.cubeActive) {
    const dx = b.x - state.cubeX;
    const dy = b.y - state.cubeY;
    const rr = CUBE_R + FIELD.R;
    if (dx * dx + dy * dy < rr * rr && state.lastTouch) {
      if (state.lastTouch === "blue") state.redFrozen = FREEZE_TIME;
      else state.blueFrozen = FREEZE_TIME;
      state.cubeActive = false;
      state.cubeTimer = nextSpawn();
      state.freezes++;
      // Nudge the ball away so it doesn't sit on the (now gone) cube.
      const d = Math.hypot(dx, dy) || 1;
      b.vx += (dx / d) * 120;
      b.vy += (dy / d) * 120;
      clampSpeed(b);
    }
  }
  return null;
}

function easeOffsets(state: GameState, dt: number) {
  const k = Math.min(1, EASE * dt);
  const nb = state.blueOffset + (state.blueTarget - state.blueOffset) * k;
  const nr = state.redOffset + (state.redTarget - state.redOffset) * k;
  state.blueVel = dt > 0 ? (nb - state.blueOffset) / dt : 0;
  state.redVel = dt > 0 ? (nr - state.redOffset) / dt : 0;
  state.blueOffset = nb;
  state.redOffset = nr;
  if (state.blueKick > 0) state.blueKick = Math.max(0, state.blueKick - dt);
  if (state.redKick > 0) state.redKick = Math.max(0, state.redKick - dt);
  // Ease the visual foot swing toward the armed kick direction (and back to 0).
  const sk = Math.min(1, SWING_EASE * dt);
  const bt = state.blueKick > 0 ? state.blueKickDir : 0;
  const rt = state.redKick > 0 ? state.redKickDir : 0;
  state.blueSwing += (bt - state.blueSwing) * sk;
  state.redSwing += (rt - state.redSwing) * sk;
  if (state.shakeCd > 0) state.shakeCd = Math.max(0, state.shakeCd - dt);
  if (state.blueFrozen > 0) state.blueFrozen = Math.max(0, state.blueFrozen - dt);
  if (state.redFrozen > 0) state.redFrozen = Math.max(0, state.redFrozen - dt);
}

function pushTrail(state: GameState) {
  state.trail.push({ x: state.ball.x, y: state.ball.y });
  if (state.trail.length > TRAIL_MAX) state.trail.shift();
}

// Advance the authoritative simulation by real-time dt (seconds).
export function stepHost(state: GameState, dt: number) {
  // Clamp targets into the legal range.
  state.blueTarget = Math.max(-FIELD.O_MAX, Math.min(FIELD.O_MAX, state.blueTarget));
  state.redTarget = Math.max(-FIELD.O_MAX, Math.min(FIELD.O_MAX, state.redTarget));
  // Frozen rods can't move or kick (authoritative enforcement).
  if (state.blueFrozen > 0) {
    state.blueTarget = state.blueOffset;
    state.blueKick = 0;
  }
  if (state.redFrozen > 0) {
    state.redTarget = state.redOffset;
    state.redKick = 0;
  }
  easeOffsets(state, dt);

  switch (state.phase) {
    case "countdown":
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) {
        state.phase = "playing";
        serve(state, state.lastScorer === "blue"); // serve toward whoever conceded
      }
      break;
    case "playing": {
      // Spawn an ice cube now and then (rare surprise).
      if (state.powerups && !state.cubeActive) {
        state.cubeTimer -= dt;
        if (state.cubeTimer <= 0) {
          state.cubeActive = true;
          state.cubeX = 300 + Math.random() * 400;
          state.cubeY = 120 + Math.random() * 360;
        }
      }
      // Sub-step so a fast ball can't tunnel through a man.
      const steps = Math.max(1, Math.min(8, Math.ceil((Math.hypot(state.ball.vx, state.ball.vy) * dt) / (FIELD.R * 0.7))));
      const sub = dt / steps;
      for (let i = 0; i < steps; i++) {
        const scorer = substep(state, sub);
        if (scorer) {
          if (scorer === "blue") state.scoreBlue++;
          else state.scoreRed++;
          state.goals++;
          state.lastScorer = scorer;
          state.ball.vx = 0;
          state.ball.vy = 0;
          const reached = state.scoreBlue >= WIN_SCORE || state.scoreRed >= WIN_SCORE;
          state.phase = "goal";
          state.phaseTimer = GOAL_TIME;
          // Thaw everyone for the restart.
          state.blueFrozen = 0;
          state.redFrozen = 0;
          state.lastTouch = null;
          if (reached) state.winner = state.scoreBlue > state.scoreRed ? "blue" : "red";
          break;
        }
      }
      pushTrail(state);
      break;
    }
    case "goal":
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) {
        if (state.winner) {
          state.phase = "matchover";
        } else {
          state.phase = "countdown";
          state.phaseTimer = COUNTDOWN_TIME;
          state.ball = { x: FIELD.W / 2, y: FIELD.H / 2, vx: 0, vy: 0 };
          state.trail = [];
        }
      }
      break;
    case "lobby":
    case "matchover":
      break;
  }
}
