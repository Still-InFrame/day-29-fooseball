// Realtime room over a single Supabase broadcast channel, keyed by room code.
// Split authority: the HOST owns the ball and broadcasts a "sync" snapshot; the
// GUEST owns only its own rod and broadcasts "rod". Presence tells us when the
// opponent is connected so we can start/pause. No Postgres during play.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Phase, Side } from "@/lib/game/engine";

export type Role = "host" | "guest";

// Host -> guest authoritative snapshot (compact keys to keep payloads small).
export interface SyncMsg {
  b: [number, number, number, number]; // ball x, y, vx, vy
  bo: number; // blue offset (host's rods)
  bs: number; // blue foot swing (-1..1) for the kick animation
  sb: number; // score blue
  sr: number; // score red
  ph: Phase;
  win: Side | null;
  pt: number; // phase timer (for countdown display)
  ca: boolean; // ice cube active
  cx: number; // cube x
  cy: number; // cube y
  bf: number; // blue frozen seconds remaining
  rf: number; // red frozen seconds remaining
}

// Guest -> host input.
export interface RodMsg {
  ro: number; // red offset (guest's rods)
  k: number; // kick direction this frame: 0 none, +1 right, -1 left
}

export interface RoomHandlers {
  onSync?: (m: SyncMsg) => void;
  onRod?: (m: RodMsg) => void;
  onShake?: () => void;
  onPresence?: (opponentPresent: boolean) => void;
  onStatus?: (status: "connecting" | "joined" | "error") => void;
}

export class RoomConnection {
  private channel: RealtimeChannel;
  private readonly id: string;
  readonly role: Role;
  readonly isHost: boolean;

  constructor(code: string, role: Role, private handlers: RoomHandlers) {
    this.role = role;
    this.isHost = role === "host";
    // A stable-per-connection id so presence can distinguish self from opponent.
    this.id = `${role}-${Math.floor(performance.now())}-${Math.floor(Math.random() * 1e6)}`;
    const supabase = createClient();
    this.channel = supabase.channel(`fooseball:${code.toUpperCase()}`, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: this.id },
      },
    });
  }

  connect() {
    this.handlers.onStatus?.("connecting");
    this.channel
      .on("broadcast", { event: "sync" }, ({ payload }) => this.handlers.onSync?.(payload as SyncMsg))
      .on("broadcast", { event: "rod" }, ({ payload }) => this.handlers.onRod?.(payload as RodMsg))
      .on("broadcast", { event: "shake" }, () => this.handlers.onShake?.())
      .on("presence", { event: "sync" }, () => {
        const state = this.channel.presenceState();
        const others = Object.keys(state).filter((k) => k !== this.id);
        this.handlers.onPresence?.(others.length > 0);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.handlers.onStatus?.("joined");
          void this.channel.track({ role: this.role, id: this.id });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.handlers.onStatus?.("error");
        }
      });
  }

  sendSync(m: SyncMsg) {
    void this.channel.send({ type: "broadcast", event: "sync", payload: m });
  }

  sendRod(m: RodMsg) {
    void this.channel.send({ type: "broadcast", event: "rod", payload: m });
  }

  sendShake() {
    void this.channel.send({ type: "broadcast", event: "shake", payload: {} });
  }

  disconnect() {
    void this.channel.unsubscribe();
  }
}
