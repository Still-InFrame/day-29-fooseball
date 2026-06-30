"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  createState,
  startMatch,
  stepHost,
  kick,
  shakeTable,
  FIELD,
  KB_SPEED,
  type GameState,
  type Side,
} from "@/lib/game/engine";
import { draw } from "@/lib/game/render";
import { RoomConnection, type RodMsg, type SyncMsg } from "@/lib/realtime/room";
import { submitResult } from "@/lib/leaderboard";
import * as sfx from "@/lib/sound";

type Mode = "host" | "guest" | "local";

export default function PlayPage() {
  return (
    <Suspense fallback={null}>
      <Game />
    </Suspense>
  );
}

function Game() {
  const params = useParams<{ code: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const code = (params.code ?? "").toUpperCase();
  const mode: Mode = (sp.get("m") as Mode) ?? "local";
  const mySide: Side | null = mode === "host" ? "blue" : mode === "guest" ? "red" : null;
  const powerups = sp.get("pu") === "1";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // ----- React-facing HUD state (updated only on change, never per-frame) -----
  const [phase, setPhase] = useState<GameState["phase"]>("lobby");
  const [scoreBlue, setScoreBlue] = useState(0);
  const [scoreRed, setScoreRed] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [winner, setWinner] = useState<Side | null>(null);
  const [opponentHere, setOpponentHere] = useState(mode === "local");
  const [conn, setConn] = useState<"connecting" | "joined" | "error">(
    mode === "local" ? "joined" : "connecting",
  );
  const [oppLeft, setOppLeft] = useState(false);
  const [goalBanner, setGoalBanner] = useState<{ key: number; side: Side } | null>(null);
  const [freezeBanner, setFreezeBanner] = useState<{ key: number; side: Side } | null>(null);
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState<"" | "code" | "link">("");

  // ----- refs (engine + loop, no re-render) -----
  const stateRef = useRef<GameState>(createState());
  const roomRef = useRef<RoomConnection | null>(null);
  const heldRef = useRef<Set<string>>(new Set());
  const pointerRef = useRef<{ active: boolean; target: number }>({ active: false, target: 0 });
  const shakeRef = useRef(0);
  const kickDirRef = useRef(0); // guest's current armed kick direction, sent to host
  const lastSentRef = useRef(0);
  const lastShakeRef = useRef(0); // client-side throttle for table shakes
  const lastSeen = useRef({ hits: 0, walls: 0, goals: 0, vx: 0, scoreBlue: 0, scoreRed: 0, bf: 0, rf: 0 });
  // Guest interpolation target from the latest host snapshot.
  const netRef = useRef<{ bx: number; by: number; bo: number; bs: number } | null>(null);
  const submittedRef = useRef(false);
  const oppHereRef = useRef(mode === "local");

  // Keep a few changing values addressable inside the rAF loop without re-subscribing.
  const muteRef = useRef(false);
  useEffect(() => {
    muteRef.current = muted;
    sfx.setMuted(muted);
  }, [muted]);

  // Apply the power-ups setting to the engine state (host/local spawn cubes).
  useEffect(() => {
    stateRef.current.powerups = powerups;
  }, [powerups]);

  // Shake the table (Space). Local screen-shake + sound for the presser; the host
  // owns the ball so it applies the jolt (guest asks via the channel). Either
  // player shaking rattles both screens.
  const triggerShake = useCallback(() => {
    const now = performance.now();
    if (now - lastShakeRef.current < 350) return;
    lastShakeRef.current = now;
    sfx.unlock();
    sfx.rattle();
    shakeRef.current = Math.max(shakeRef.current, 22);
    if (mode === "guest") {
      roomRef.current?.sendShake();
    } else {
      shakeTable(stateRef.current);
      if (mode === "host") roomRef.current?.sendShake(); // rattle the guest's screen too
    }
  }, [mode]);

  // ---------------- input ----------------
  // Kicks are continuous: holding a kick key keeps the rod "armed" in that
  // direction, so any contact during the hold drives the ball. Movement and kick
  // are both read per-frame from heldRef (see the game loop's applyMyInput).
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const c = e.code;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(c)) e.preventDefault();
      sfx.unlock();
      const already = heldRef.current.has(c);
      heldRef.current.add(c);
      if (c === "Space" && !already) triggerShake();
    };
    const onUp = (e: KeyboardEvent) => heldRef.current.delete(e.code);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [triggerShake]);

  // pointer / touch control: maps Y on the canvas to your rod offset
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const toOffset = (clientY: number) => {
      const rect = el.getBoundingClientRect();
      const fieldY = ((clientY - rect.top) / rect.height) * FIELD.H;
      return Math.max(-FIELD.O_MAX, Math.min(FIELD.O_MAX, fieldY - FIELD.H / 2));
    };
    const down = (e: PointerEvent) => {
      sfx.unlock();
      pointerRef.current.active = true;
      pointerRef.current.target = toOffset(e.clientY);
    };
    const move = (e: PointerEvent) => {
      if (pointerRef.current.active) pointerRef.current.target = toOffset(e.clientY);
    };
    const up = () => (pointerRef.current.active = false);
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, []);

  // ---------------- networking ----------------
  useEffect(() => {
    if (mode === "local") {
      startMatch(stateRef.current);
      return;
    }
    const room = new RoomConnection(code, mode, {
      onStatus: setConn,
      onPresence: (present) => {
        oppHereRef.current = present;
        setOpponentHere(present);
        if (!present && stateRef.current.phase !== "lobby") setOppLeft(true);
        // Host kicks off the match once the opponent arrives.
        if (present && mode === "host" && stateRef.current.phase === "lobby") {
          startMatch(stateRef.current);
        }
      },
      onSync: (m: SyncMsg) => {
        // Guest only.
        const s = stateRef.current;
        netRef.current = { bx: m.b[0], by: m.b[1], bo: m.bo, bs: m.bs };
        s.ball.vx = m.b[2];
        s.ball.vy = m.b[3];
        s.scoreBlue = m.sb;
        s.scoreRed = m.sr;
        s.phase = m.ph;
        s.phaseTimer = m.pt;
        s.winner = m.win;
        s.cubeActive = m.ca;
        s.cubeX = m.cx;
        s.cubeY = m.cy;
        s.blueFrozen = m.bf;
        s.redFrozen = m.rf;
        setOppLeft(false);
      },
      onRod: (m: RodMsg) => {
        // Host only: feed the guest's rod as red's target + directional kick.
        const s = stateRef.current;
        s.redTarget = Math.max(-FIELD.O_MAX, Math.min(FIELD.O_MAX, m.ro));
        if (m.k) kick(s, "red", m.k);
      },
      onShake: () => {
        // The opponent shook: rattle our screen + sound; host applies the jolt.
        shakeRef.current = Math.max(shakeRef.current, 22);
        sfx.rattle();
        if (mode === "host") shakeTable(stateRef.current);
      },
    });
    roomRef.current = room;
    room.connect();
    return () => {
      room.disconnect();
      roomRef.current = null;
    };
  }, [code, mode]);

  // ---------------- game loop ----------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    canvas.width = FIELD.W * dpr;
    canvas.height = FIELD.H * dpr;
    const ctx = canvas.getContext("2d")!;

    let raf = 0;
    let last = performance.now();

    const reflectedPhaseRef = { current: stateRef.current.phase };
    const countdownRef = { current: 0 };
    const reflectPhase = () => {
      const s = stateRef.current;
      reflectedPhaseRef.current = s.phase;
      setPhase(s.phase);
      setWinner(s.winner);
      if (s.phase === "matchover") sfx.fanfare();
      if (s.phase === "countdown") {
        // New match: resync scores without firing a goal banner.
        lastSeen.current.scoreBlue = s.scoreBlue;
        lastSeen.current.scoreRed = s.scoreRed;
        setScoreBlue(s.scoreBlue);
        setScoreRed(s.scoreRed);
        submittedRef.current = false;
        setGoalBanner(null);
        setFreezeBanner(null);
      }
    };

    const applyMyInput = (dt: number) => {
      const s = stateRef.current;
      const held = heldRef.current;
      const ptr = pointerRef.current;
      const move = (cur: number, up: boolean, down: boolean) => {
        let t = cur;
        if (up) t -= KB_SPEED * dt;
        if (down) t += KB_SPEED * dt;
        return Math.max(-FIELD.O_MAX, Math.min(FIELD.O_MAX, t));
      };
      // Returns the armed kick direction (0 none). Holding keeps it armed.
      const arm = (left: boolean, right: boolean) => (right ? 1 : left ? -1 : 0);

      if (mode === "local") {
        if (s.blueFrozen <= 0) {
          s.blueTarget = move(s.blueTarget, held.has("KeyW"), held.has("KeyS"));
          const bk = arm(held.has("KeyA"), held.has("KeyD"));
          if (bk) kick(s, "blue", bk);
        }
        if (s.redFrozen <= 0) {
          s.redTarget = move(s.redTarget, held.has("ArrowUp"), held.has("ArrowDown"));
          const rk = arm(held.has("ArrowLeft"), held.has("ArrowRight"));
          if (rk) kick(s, "red", rk);
        }
      } else if (mySide) {
        const myFrozen = mySide === "blue" ? s.blueFrozen > 0 : s.redFrozen > 0;
        if (myFrozen) {
          kickDirRef.current = 0; // frozen: no input goes out
          return;
        }
        const up = held.has("ArrowUp") || held.has("KeyW");
        const down = held.has("ArrowDown") || held.has("KeyS");
        // <- / -> (or A / D) kick left / right.
        const kd = arm(held.has("ArrowLeft") || held.has("KeyA"), held.has("ArrowRight") || held.has("KeyD"));
        if (mySide === "blue") {
          s.blueTarget = ptr.active ? ptr.target : move(s.blueTarget, up, down);
          if (kd) kick(s, "blue", kd);
        } else {
          s.redTarget = ptr.active ? ptr.target : move(s.redTarget, up, down);
          if (kd) {
            // Guest: arm locally for the glow; the host applies the actual kick.
            s.redKick = 0.16;
            s.redKickDir = kd;
          }
        }
        kickDirRef.current = kd; // surfaced to the guest's rod broadcast
      }
    };

    const playEventSounds = () => {
      const s = stateRef.current;
      const seen = lastSeen.current;
      if (s.hits !== seen.hits) sfx.thunk();
      if (s.walls !== seen.walls) sfx.wall();
      seen.hits = s.hits;
      seen.walls = s.walls;
    };

    // Fire the icy zap + "FROZEN!" banner on the rising edge of a freeze.
    const onFreezeChange = () => {
      const s = stateRef.current;
      const seen = lastSeen.current;
      const bfUp = s.blueFrozen > 0 && seen.bf <= 0;
      const rfUp = s.redFrozen > 0 && seen.rf <= 0;
      seen.bf = s.blueFrozen;
      seen.rf = s.redFrozen;
      if (bfUp || rfUp) {
        sfx.freeze();
        shakeRef.current = Math.max(shakeRef.current, 12);
        setFreezeBanner({ key: performance.now(), side: bfUp ? "blue" : "red" });
      }
    };

    const onScoreChange = () => {
      const s = stateRef.current;
      const seen = lastSeen.current;
      if (s.scoreBlue === seen.scoreBlue && s.scoreRed === seen.scoreRed) return;
      const blueUp = s.scoreBlue > seen.scoreBlue;
      const redUp = s.scoreRed > seen.scoreRed;
      seen.scoreBlue = s.scoreBlue;
      seen.scoreRed = s.scoreRed;
      setScoreBlue(s.scoreBlue);
      setScoreRed(s.scoreRed);
      if (blueUp || redUp) {
        setGoalBanner({ key: performance.now(), side: blueUp ? "blue" : "red" });
        shakeRef.current = 16;
        sfx.goal();
      }
    };

    const buildSync = (): SyncMsg => {
      const s = stateRef.current;
      return {
        b: [s.ball.x, s.ball.y, s.ball.vx, s.ball.vy],
        bo: s.blueOffset,
        bs: s.blueSwing,
        sb: s.scoreBlue,
        sr: s.scoreRed,
        ph: s.phase,
        win: s.winner,
        pt: s.phaseTimer,
        ca: s.cubeActive,
        cx: s.cubeX,
        cy: s.cubeY,
        bf: s.blueFrozen,
        rf: s.redFrozen,
      };
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = stateRef.current;

      applyMyInput(dt);

      if (mode === "host" || mode === "local") {
        const prevPhase = s.phase;
        stepHost(s, dt);
        playEventSounds();
        onScoreChange();
        onFreezeChange();
        if (s.phase !== prevPhase) reflectPhase();
        if (mode === "host") {
          // Throttle snapshots to ~25Hz, but send immediately on a phase change.
          if (now - lastSentRef.current > 40 || s.phase !== prevPhase) {
            roomRef.current?.sendSync(buildSync());
            lastSentRef.current = now;
          }
        }
      } else {
        // Guest: ease own rod locally, interpolate the rest toward the host snapshot.
        const k = Math.min(1, 22 * dt);
        s.redOffset += (s.redTarget - s.redOffset) * k;
        if (s.redKick > 0) s.redKick = Math.max(0, s.redKick - dt);
        // Ease our own foot swing locally (host's swing comes from the snapshot).
        const rt = s.redKick > 0 ? s.redKickDir : 0;
        s.redSwing += (rt - s.redSwing) * Math.min(1, 15 * dt);
        const net = netRef.current;
        if (net) {
          s.blueSwing += (net.bs - s.blueSwing) * 0.4;
          // thunk when the host's ball sharply reverses (approx hit/wall feedback)
          if (Math.sign(s.ball.vx) !== Math.sign(lastSeen.current.vx) && Math.abs(s.ball.vx) > 120) {
            sfx.thunk();
          }
          lastSeen.current.vx = s.ball.vx;
          const lerp = 0.35;
          s.ball.x += (net.bx - s.ball.x) * lerp;
          s.ball.y += (net.by - s.ball.y) * lerp;
          s.blueOffset += (net.bo - s.blueOffset) * 0.4;
          if (s.phase === "playing") {
            s.trail.push({ x: s.ball.x, y: s.ball.y });
            if (s.trail.length > 14) s.trail.shift();
          }
        }
        onScoreChange();
        onFreezeChange();
        if (s.phase !== reflectedPhaseRef.current) reflectPhase();
        // Send our rod input ~25Hz.
        if (now - lastSentRef.current > 40) {
          roomRef.current?.sendRod({ ro: s.redOffset, k: kickDirRef.current });
          lastSentRef.current = now;
        }
      }

      // countdown number for the HUD
      if (s.phase === "countdown") {
        const n = Math.max(1, Math.ceil(s.phaseTimer));
        if (n !== countdownRef.current) {
          countdownRef.current = n;
          setCountdown(n);
        }
      }

      // shake decay + draw
      shakeRef.current = Math.max(0, shakeRef.current - dt * 40);
      draw(ctx, s, { dpr, shake: shakeRef.current, mySide });
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mode, mySide]);

  // ---------------- match-over / leaderboard ----------------
  const iWon = mySide ? winner === mySide : false;
  const myGoals = mySide === "red" ? scoreRed : scoreBlue;
  const oppGoals = mySide === "red" ? scoreBlue : scoreRed;

  const rematch = () => {
    if (mode === "guest") return; // host controls restart
    submittedRef.current = false;
    startMatch(stateRef.current);
  };

  const flash = (what: "code" | "link") => {
    setCopied(what);
    window.setTimeout(() => setCopied(""), 1500);
  };
  const copyCode = () => {
    void navigator.clipboard?.writeText(code).catch(() => {});
    flash("code");
  };
  const copyLink = () => {
    const url = `${window.location.origin}/play/${code}?m=guest`;
    void navigator.clipboard?.writeText(url).catch(() => {});
    flash("link");
  };

  // Touch controls: hold a kick button to arm that direction (reuses heldRef so
  // applyMyInput treats it exactly like the arrow keys); tap shake. The button's
  // data-code attribute carries which arrow it maps to.
  const onKickDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const codeName = e.currentTarget.dataset.code;
    if (codeName) heldRef.current.add(codeName);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  }, []);
  const onKickUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const codeName = e.currentTarget.dataset.code;
    if (codeName) heldRef.current.delete(codeName);
  }, []);

  return (
    <main className="flex-1 w-full max-w-4xl mx-auto px-3 py-4 flex flex-col items-center">
      {/* scoreboard */}
      <div className="w-full flex items-center justify-between mb-3 arcade">
        <button onClick={() => router.push("/")} className="text-[0.5rem] opacity-60 hover:text-amber">
          ‹ menu
        </button>
        <div className="flex items-center gap-4 text-xl sm:text-2xl">
          <span className="text-blue">{scoreBlue}</span>
          <span className="opacity-40 text-sm">—</span>
          <span className="text-red">{scoreRed}</span>
        </div>
        <button onClick={() => setMuted((m) => !m)} className="text-[0.6rem] opacity-60 hover:text-amber w-8">
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      {/* table */}
      <div ref={wrapRef} className="relative w-full" style={{ aspectRatio: `${FIELD.W} / ${FIELD.H}` }}>
        <canvas ref={canvasRef} className="w-full h-full rounded-lg crt-glow block touch-none" />
        <div className="scanlines" />

        {/* goal flash */}
        {goalBanner && (
          <div
            key={goalBanner.key}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <span
              className={`goal-flash arcade text-3xl sm:text-5xl ${goalBanner.side === "blue" ? "text-blue" : "text-red"}`}
              style={{ textShadow: "4px 4px 0 rgba(0,0,0,0.7)" }}
            >
              GOAL!
            </span>
          </div>
        )}

        {/* freeze flash */}
        {freezeBanner && (
          <div
            key={`f${freezeBanner.key}`}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <span
              className="goal-flash arcade text-2xl sm:text-4xl"
              style={{ color: "#9be1ff", textShadow: "3px 3px 0 rgba(0,40,80,0.7)" }}
            >
              ❄ {freezeBanner.side.toUpperCase()} FROZEN!
            </span>
          </div>
        )}

        {/* countdown */}
        {phase === "countdown" && (
          <Overlay>
            <span className="arcade text-6xl text-amber blink">{countdown}</span>
          </Overlay>
        )}

        {/* lobby / connecting */}
        {phase === "lobby" && mode !== "local" && (
          <Overlay>
            {mode === "host" ? (
              <div className="text-center arcade space-y-4">
                <p className="text-[0.6rem] opacity-70">INVITE A FRIEND</p>
                <button onClick={copyCode} className="text-amber text-5xl tracking-[0.3em] hover:opacity-80 block mx-auto">
                  {code}
                </button>
                <button onClick={copyLink} className="btn text-blue !text-[0.55rem] mx-auto">
                  {copied === "link" ? "link copied ✓" : "📋 Copy invite link"}
                </button>
                <p className="text-[0.5rem] opacity-50">
                  {copied === "code" ? "code copied ✓" : "tap the code to copy it"}
                </p>
                <p className="text-[0.55rem] opacity-70 blink mt-2">waiting for opponent…</p>
              </div>
            ) : (
              <div className="text-center arcade space-y-3">
                <p className="text-[0.6rem] opacity-70">JOINING ROOM</p>
                <p className="text-amber text-4xl tracking-[0.3em]">{code}</p>
                <p className="text-[0.55rem] opacity-70 blink">
                  {conn === "error" ? "connection error" : opponentHere ? "starting…" : "waiting for host…"}
                </p>
              </div>
            )}
          </Overlay>
        )}

        {/* opponent left */}
        {oppLeft && phase !== "matchover" && (
          <Overlay>
            <div className="text-center arcade space-y-4">
              <p className="text-red text-sm">OPPONENT LEFT</p>
              <button onClick={() => router.push("/")} className="btn text-amber !text-[0.6rem]">
                Back to menu
              </button>
            </div>
          </Overlay>
        )}

        {/* match over */}
        {phase === "matchover" && (
          <Overlay>
            <MatchOver
              mode={mode}
              winner={winner}
              iWon={iWon}
              myGoals={myGoals}
              oppGoals={oppGoals}
              submittedRef={submittedRef}
              onRematch={rematch}
              onHome={() => router.push("/")}
            />
          </Overlay>
        )}
      </div>

      {/* touch / click controls — drag the table to move, these to kick + shake */}
      <div className="w-full max-w-md grid grid-cols-3 gap-2 mt-3 select-none" style={{ touchAction: "none" }}>
        <button
          data-code="ArrowLeft"
          onPointerDown={onKickDown}
          onPointerUp={onKickUp}
          onPointerLeave={onKickUp}
          onPointerCancel={onKickUp}
          className="btn text-blue !text-[0.6rem] !py-3"
        >
          ◀ KICK
        </button>
        <button onPointerDown={(e) => { e.preventDefault(); triggerShake(); }} className="btn text-amber !text-[0.6rem] !py-3">
          SHAKE
        </button>
        <button
          data-code="ArrowRight"
          onPointerDown={onKickDown}
          onPointerUp={onKickUp}
          onPointerLeave={onKickUp}
          onPointerCancel={onKickUp}
          className="btn text-blue !text-[0.6rem] !py-3"
        >
          KICK ▶
        </button>
      </div>

      {/* controls hint */}
      <p className="arcade text-[0.45rem] opacity-50 mt-3 text-center leading-relaxed">
        {mode === "local"
          ? "BLUE: W/S move · A/D kick    ·    RED: ↑/↓ move · ←/→ kick    ·    SPACE: shake table"
          : `${mySide?.toUpperCase()} · drag the table or ↑/↓ to move · ←/→ or buttons to kick · SPACE / shake button`}
      </p>
    </main>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/55 rounded-lg backdrop-blur-[2px]">
      {children}
    </div>
  );
}

function MatchOver({
  mode,
  winner,
  iWon,
  myGoals,
  oppGoals,
  submittedRef,
  onRematch,
  onHome,
}: {
  mode: Mode;
  winner: Side | null;
  iWon: boolean;
  myGoals: number;
  oppGoals: number;
  submittedRef: React.RefObject<boolean>;
  onRematch: () => void;
  onHome: () => void;
}) {
  const [initials, setInitials] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem("fooseball_initials") ?? "" : "",
  );
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (submittedRef.current) return;
    const ini = initials.toUpperCase().slice(0, 3) || "???";
    submittedRef.current = true;
    localStorage.setItem("fooseball_initials", ini);
    try {
      await submitResult({
        initials: ini,
        result: iWon ? "win" : "loss",
        goalsFor: myGoals,
        goalsAgainst: oppGoals,
      });
      setSaved(true);
    } catch {
      submittedRef.current = false;
    }
  };

  if (mode === "local") {
    return (
      <div className="text-center arcade space-y-5">
        <p className={`text-2xl ${winner === "blue" ? "text-blue" : "text-red"}`}>
          {winner?.toUpperCase()} WINS
        </p>
        <p className="text-[0.6rem] opacity-70">
          {Math.max(myGoals, oppGoals)} — {Math.min(myGoals, oppGoals)}
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={onRematch} className="btn text-amber !text-[0.6rem]">
            Play again
          </button>
          <button onClick={onHome} className="btn text-white/70 !text-[0.6rem]">
            Menu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center arcade space-y-4 w-[min(92%,320px)]">
      <p className={`text-2xl ${iWon ? "text-amber" : "opacity-70"}`}>{iWon ? "YOU WIN!" : "YOU LOSE"}</p>
      <p className="text-[0.6rem] opacity-70">
        {myGoals} — {oppGoals}
      </p>

      {!saved ? (
        <div className="space-y-2">
          <p className="text-[0.5rem] opacity-70">enter your initials</p>
          <div className="flex gap-2 justify-center">
            <input
              value={initials}
              onChange={(e) => setInitials(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3))}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="AAA"
              maxLength={3}
              className="arcade bg-black/50 border-[3px] border-white/30 rounded px-3 py-2 w-24 text-center text-lg tracking-[0.3em] uppercase outline-none focus:border-amber"
            />
            <button onClick={save} disabled={initials.length === 0} className="btn text-amber !text-[0.55rem]">
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[0.55rem] text-green-400">saved to leaderboard ✓</p>
      )}

      <div className="flex gap-3 justify-center pt-1">
        {mode === "host" ? (
          <button onClick={onRematch} className="btn text-blue !text-[0.55rem]">
            Rematch
          </button>
        ) : (
          <span className="arcade text-[0.45rem] opacity-50 self-center">waiting for host…</span>
        )}
        <button onClick={onHome} className="btn text-white/70 !text-[0.55rem]">
          Menu
        </button>
      </div>
    </div>
  );
}
