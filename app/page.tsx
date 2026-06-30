"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Leaderboard from "@/components/Leaderboard";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid confusion

function newCode() {
  let c = "";
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

export default function Home() {
  const router = useRouter();
  const [join, setJoin] = useState("");

  const create = () => router.push(`/play/${newCode()}?m=host`);
  const doJoin = () => {
    const code = join.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (code.length === 4) router.push(`/play/${code}?m=guest`);
  };

  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8 sm:py-12">
      <header className="text-center mb-10">
        <h1 className="arcade text-amber text-2xl sm:text-4xl mb-3 drop-shadow-[3px_3px_0_rgba(0,0,0,0.6)]">
          FOOSE<span className="text-red">BALL</span>
        </h1>
        <p className="arcade text-[0.55rem] sm:text-[0.65rem] opacity-70 leading-relaxed">
          real-time 2-player foosball · first to 5 wins
        </p>
      </header>

      <div className="grid md:grid-cols-[1.3fr_1fr] gap-6">
        <section className="space-y-5">
          <div className="border-[3px] border-amber/70 crt-glow rounded-lg p-5 bg-black/30">
            <h2 className="arcade text-[0.7rem] text-amber mb-4">START A MATCH</h2>

            <button onClick={create} className="btn text-blue w-full mb-5 !text-[0.8rem]">
              ▶ Create Room
            </button>

            <div className="text-[0.55rem] opacity-50 arcade text-center mb-3">— or join a friend —</div>

            <div className="flex gap-2">
              <input
                value={join}
                onChange={(e) => setJoin(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && doJoin()}
                placeholder="CODE"
                maxLength={4}
                className="arcade flex-1 bg-black/50 border-[3px] border-white/30 rounded px-3 py-3 text-center text-lg tracking-[0.4em] uppercase outline-none focus:border-amber"
              />
              <button onClick={doJoin} disabled={join.length < 4} className="btn text-red">
                Join
              </button>
            </div>
          </div>

          <div className="border-[3px] border-white/15 rounded-lg p-5 bg-black/20">
            <h3 className="arcade text-[0.6rem] opacity-80 mb-3">HOW TO PLAY</h3>
            <ul className="arcade text-[0.5rem] leading-[1.8] opacity-70 space-y-1">
              <li>↑ / ↓ — slide your rods</li>
              <li>← / → — kick the ball (left / right)</li>
              <li>SPACE — shake the table (frees a stuck ball)</li>
              <li>create a room, share the 4-letter code</li>
            </ul>
            <button
              onClick={() => router.push("/play/SOLO?m=local")}
              className="btn text-white/80 mt-4 !text-[0.55rem]"
            >
              🎮 Practice (local 2-player)
            </button>
          </div>
        </section>

        <aside className="border-[3px] border-white/15 rounded-lg p-5 bg-black/20">
          <Leaderboard />
        </aside>
      </div>

      <footer className="arcade text-center text-[0.45rem] opacity-40 mt-10 leading-relaxed">
        day 29 · 100-day ai build challenge ·{" "}
        <a href="https://www.100dayaichallenge.com/share/savion" className="underline hover:text-amber">
          savion
        </a>
      </footer>
    </main>
  );
}
