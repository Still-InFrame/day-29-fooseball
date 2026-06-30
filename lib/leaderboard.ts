// Leaderboard: persistent results in the one Postgres table. Each browser logs
// its OWN player's result at match end (winner logs a win, loser logs a loss),
// so both sides are represented. Reads aggregate client-side and live-update via
// Realtime postgres_changes.

import { createClient } from "@/lib/supabase/client";

export interface ScoreRow {
  initials: string;
  result: "win" | "loss";
  goals_for: number;
  goals_against: number;
  created_at: string;
}

export interface LeaderEntry {
  initials: string;
  wins: number;
  losses: number;
  games: number;
  goalsFor: number;
  winRate: number;
}

export async function submitResult(row: {
  initials: string;
  result: "win" | "loss";
  goalsFor: number;
  goalsAgainst: number;
}) {
  const supabase = createClient();
  const initials = row.initials.toUpperCase().slice(0, 3).replace(/[^A-Z0-9]/g, "") || "???";
  const { error } = await supabase.from("fooseball_scores").insert({
    initials,
    result: row.result,
    goals_for: row.goalsFor,
    goals_against: row.goalsAgainst,
  });
  if (error) throw error;
}

export async function fetchLeaderboard(): Promise<LeaderEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("fooseball_scores")
    .select("initials,result,goals_for,goals_against,created_at")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return aggregate((data ?? []) as ScoreRow[]);
}

function aggregate(rows: ScoreRow[]): LeaderEntry[] {
  const map = new Map<string, LeaderEntry>();
  for (const r of rows) {
    const e =
      map.get(r.initials) ??
      { initials: r.initials, wins: 0, losses: 0, games: 0, goalsFor: 0, winRate: 0 };
    e.games++;
    e.goalsFor += r.goals_for ?? 0;
    if (r.result === "win") e.wins++;
    else e.losses++;
    map.set(r.initials, e);
  }
  const list = [...map.values()];
  for (const e of list) e.winRate = e.games ? e.wins / e.games : 0;
  // Rank by wins, then win-rate, then fewest games (efficiency).
  list.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || a.games - b.games);
  return list.slice(0, 12);
}

// Subscribe to inserts; calls back with a freshly-aggregated leaderboard.
export function subscribeLeaderboard(onChange: (entries: LeaderEntry[]) => void) {
  const supabase = createClient();
  const channel = supabase
    .channel("fooseball:leaderboard")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "fooseball_scores" }, () => {
      void fetchLeaderboard().then(onChange).catch(() => {});
    })
    .subscribe();
  return () => void supabase.removeChannel(channel);
}
