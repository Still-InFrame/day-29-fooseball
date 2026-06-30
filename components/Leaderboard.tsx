"use client";

import { useEffect, useState } from "react";
import { fetchLeaderboard, subscribeLeaderboard, type LeaderEntry } from "@/lib/leaderboard";

export default function Leaderboard({ className = "" }: { className?: string }) {
  const [entries, setEntries] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchLeaderboard()
      .then((e) => alive && setEntries(e))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    const unsub = subscribeLeaderboard((e) => alive && setEntries(e));
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  return (
    <div className={`arcade ${className}`}>
      <h2 className="text-amber text-[0.7rem] mb-3 flex items-center gap-2">
        <span>🏆</span> LEADERBOARD
      </h2>
      {loading ? (
        <p className="text-[0.6rem] opacity-60">loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-[0.55rem] opacity-60 leading-relaxed">
          No champions yet. Be the first to claim the table.
        </p>
      ) : (
        <ol className="space-y-1.5 text-[0.6rem]">
          <li className="flex gap-2 opacity-50 text-[0.5rem] pb-1">
            <span className="w-6">#</span>
            <span className="flex-1">WHO</span>
            <span className="w-8 text-right">W</span>
            <span className="w-8 text-right">L</span>
            <span className="w-10 text-right">GF</span>
          </li>
          {entries.map((e, i) => (
            <li key={e.initials} className="flex gap-2 items-center">
              <span className={`w-6 ${i === 0 ? "text-amber" : "opacity-60"}`}>{i + 1}</span>
              <span className="flex-1 tracking-widest">{e.initials}</span>
              <span className="w-8 text-right text-green-400">{e.wins}</span>
              <span className="w-8 text-right opacity-60">{e.losses}</span>
              <span className="w-10 text-right opacity-80">{e.goalsFor}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
