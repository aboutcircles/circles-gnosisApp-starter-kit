import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { SoloRound } from "@/types/solo";

const DATA_DIR = path.join(process.cwd(), "data");
const ROUNDS_FILE = path.join(DATA_DIR, "solo-rounds.json");
const SUPABASE_ROUNDS_TABLE = process.env.SUPABASE_ROUNDS_TABLE || "solo_rounds";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

type SoloRoundRow = {
  id: string;
  created_at: string;
  updated_at: string;
  round: SoloRound;
};

let writeQueue = Promise.resolve();
let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  return supabaseClient;
}

async function ensureStore() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(ROUNDS_FILE, "utf8");
  } catch {
    await writeFile(ROUNDS_FILE, "[]\n", "utf8");
  }
}

async function readRounds(): Promise<SoloRound[]> {
  await ensureStore();

  const raw = await readFile(ROUNDS_FILE, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed as SoloRound[];
}

async function writeRounds(rounds: SoloRound[]) {
  await ensureStore();
  await writeFile(ROUNDS_FILE, JSON.stringify(rounds, null, 2) + "\n", "utf8");
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function listLocalRounds(limit: number = 40): Promise<SoloRound[]> {
  const rounds = await readRounds();

  return rounds
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

async function getLocalRound(roundId: string): Promise<SoloRound | null> {
  const rounds = await readRounds();
  return rounds.find((round) => round.id === roundId) ?? null;
}

async function createLocalRoundRecord(round: SoloRound): Promise<void> {
  await enqueue(async () => {
    const rounds = await readRounds();
    rounds.unshift(round);
    await writeRounds(rounds);
  });
}

async function updateLocalRound(
  roundId: string,
  updater: (round: SoloRound) => SoloRound
): Promise<SoloRound | null> {
  return enqueue(async () => {
    const rounds = await readRounds();
    const index = rounds.findIndex((round) => round.id === roundId);

    if (index < 0) {
      return null;
    }

    const updated = updater(rounds[index]);
    rounds[index] = updated;
    await writeRounds(rounds);

    return updated;
  });
}

export async function listSoloRounds(limit: number = 40): Promise<SoloRound[]> {
  const client = getSupabaseClient();
  if (!client) {
    return listLocalRounds(limit);
  }

  const { data, error } = await client
    .from(SUPABASE_ROUNDS_TABLE)
    .select("round, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Supabase list rounds failed: ${error.message}`);
  }

  return ((data ?? []) as Array<{ round: SoloRound }>).map((row) => row.round);
}

export async function getSoloRound(roundId: string): Promise<SoloRound | null> {
  const client = getSupabaseClient();
  if (!client) {
    return getLocalRound(roundId);
  }

  const { data, error } = await client
    .from(SUPABASE_ROUNDS_TABLE)
    .select("round")
    .eq("id", roundId)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase get round failed: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return (data as { round: SoloRound }).round;
}

export async function createSoloRoundRecord(round: SoloRound): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    return createLocalRoundRecord(round);
  }

  const row: SoloRoundRow = {
    id: round.id,
    created_at: round.createdAt,
    updated_at: round.updatedAt,
    round
  };

  const { error } = await client.from(SUPABASE_ROUNDS_TABLE).insert(row);

  if (error) {
    throw new Error(`Supabase create round failed: ${error.message}`);
  }
}

export async function updateSoloRound(
  roundId: string,
  updater: (round: SoloRound) => SoloRound
): Promise<SoloRound | null> {
  const client = getSupabaseClient();
  if (!client) {
    return updateLocalRound(roundId, updater);
  }

  const { data: current, error: readError } = await client
    .from(SUPABASE_ROUNDS_TABLE)
    .select("round")
    .eq("id", roundId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Supabase read-before-update failed: ${readError.message}`);
  }

  if (!current) {
    return null;
  }

  const nextRound = updater((current as { round: SoloRound }).round);
  const updatedAt = nextRound.updatedAt || new Date().toISOString();
  const roundToStore =
    nextRound.updatedAt === updatedAt ? nextRound : { ...nextRound, updatedAt };

  const { data, error } = await client
    .from(SUPABASE_ROUNDS_TABLE)
    .update({
      round: roundToStore,
      updated_at: updatedAt
    })
    .eq("id", roundId)
    .select("round")
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase update round failed: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return (data as { round: SoloRound }).round;
}
