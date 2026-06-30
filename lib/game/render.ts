// Canvas renderer for the foosball table. Draws everything in logical FIELD units
// (0..W, 0..H); the caller sizes the backing store and we apply the DPR + shake
// transform here. Stateless aside from what's in GameState.

import { FIELD, RODS, type GameState, type Side } from "./engine";

const COLORS = {
  feltLight: "#15904b",
  feltDark: "#0a5e30",
  line: "rgba(255,255,255,0.55)",
  rod: "#d7dde4",
  rodShade: "#9aa3ad",
  blue: "#3b82f6",
  blueDark: "#1e3a8a",
  red: "#ef4444",
  redDark: "#7f1d1d",
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawField(ctx: CanvasRenderingContext2D) {
  const { W, H, GOAL_HALF } = FIELD;
  // Felt with a soft radial highlight in the center.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, COLORS.feltLight);
  g.addColorStop(1, COLORS.feltDark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const rg = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W / 1.4);
  rg.addColorStop(0, "rgba(255,255,255,0.10)");
  rg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 3;
  // Outer boundary.
  ctx.strokeRect(8, 8, W - 16, H - 16);
  // Center line + circle.
  ctx.beginPath();
  ctx.setLineDash([10, 12]);
  ctx.moveTo(W / 2, 8);
  ctx.lineTo(W / 2, H - 8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 70, 0, Math.PI * 2);
  ctx.stroke();

  // Goal mouths (dark recesses) on each end.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, H / 2 - GOAL_HALF, 8, GOAL_HALF * 2);
  ctx.fillRect(W - 8, H / 2 - GOAL_HALF, 8, GOAL_HALF * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(8, H / 2 - GOAL_HALF);
  ctx.lineTo(8, H / 2 + GOAL_HALF);
  ctx.moveTo(W - 8, H / 2 - GOAL_HALF);
  ctx.lineTo(W - 8, H / 2 + GOAL_HALF);
  ctx.stroke();
}

function drawRodsAndMen(ctx: CanvasRenderingContext2D, state: GameState, mySide: Side | null) {
  const { H, HW, MH } = FIELD;
  // Metal rods first (behind men).
  for (const rod of RODS) {
    const rg = ctx.createLinearGradient(rod.x - 3, 0, rod.x + 3, 0);
    rg.addColorStop(0, COLORS.rodShade);
    rg.addColorStop(0.5, COLORS.rod);
    rg.addColorStop(1, COLORS.rodShade);
    ctx.fillStyle = rg;
    ctx.fillRect(rod.x - 3, 0, 6, H);
  }
  // Men. Each figure has a torso gripping the rod and a leg/foot that swings out
  // along the play axis when the player kicks (swing in -1..1).
  const REACH = 26; // how far the foot juts out at full swing
  for (const rod of RODS) {
    const offset = rod.side === "blue" ? state.blueOffset : state.redOffset;
    const swing = rod.side === "blue" ? state.blueSwing : state.redSwing;
    const base = rod.side === "blue" ? COLORS.blue : COLORS.red;
    const dark = rod.side === "blue" ? COLORS.blueDark : COLORS.redDark;
    const mine = mySide === rod.side;
    const footX = rod.x + swing * REACH;
    for (const baseY of rod.men) {
      const y = baseY + offset;

      // Shadow of the foot on the felt.
      if (Math.abs(swing) > 0.05) {
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.beginPath();
        ctx.ellipse(footX + 2, y + 4, 11, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      if (mine) {
        ctx.shadowColor = base;
        ctx.shadowBlur = 10 + Math.abs(swing) * 22;
      }

      // Leg: a tapered bar from the rod out to the foot.
      ctx.strokeStyle = dark;
      ctx.lineWidth = 11;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(rod.x, y);
      ctx.lineTo(footX, y);
      ctx.stroke();

      // Foot / boot at the end of the leg.
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.arc(footX, y, HW + 2, 0, Math.PI * 2);
      ctx.fill();

      // Torso gripping the rod (leans slightly into the kick).
      const lean = swing * 4;
      const g = ctx.createLinearGradient(rod.x - HW, 0, rod.x + HW, 0);
      g.addColorStop(0, dark);
      g.addColorStop(0.5, base);
      g.addColorStop(1, dark);
      ctx.fillStyle = g;
      roundRect(ctx, rod.x - HW + lean, y - MH, HW * 2, MH * 1.5, 5);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Head highlight.
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(rod.x + lean, y - MH + 9, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBall(ctx: CanvasRenderingContext2D, state: GameState) {
  const { R } = FIELD;
  // Trail.
  for (let i = 0; i < state.trail.length; i++) {
    const t = state.trail[i];
    const a = (i / state.trail.length) * 0.4;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, R * (0.4 + (i / state.trail.length) * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  const b = state.ball;
  // Shadow.
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(b.x + 3, b.y + 4, R, R * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  // Ball.
  const g = ctx.createRadialGradient(b.x - R / 3, b.y - R / 3, 1, b.x, b.y, R);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#cfcfcf");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(b.x, b.y, R, 0, Math.PI * 2);
  ctx.fill();
}

export interface DrawOpts {
  dpr: number;
  shake: number; // pixels of jitter (logical units)
  mySide: Side | null;
}

export function draw(ctx: CanvasRenderingContext2D, state: GameState, opts: DrawOpts) {
  const { dpr, shake, mySide } = opts;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, FIELD.W, FIELD.H);
  if (shake > 0) {
    const dx = (Math.random() - 0.5) * shake;
    const dy = (Math.random() - 0.5) * shake;
    ctx.translate(dx, dy);
  }
  drawField(ctx);
  drawRodsAndMen(ctx, state, mySide);
  drawBall(ctx, state);
}
