/**
 * SL-43: safe model updates on the phone (US-MODEL-04). The steps and their rules live in @hermit/model
 * (checkManifest, stepUpdate, recoverUpdate); this file only keeps the journal, the active pointer and the
 * files. Every state is written to the journal before its effects run, so a kill at any point is recovered
 * on the next launch. With no manifest source pinned in the build (today, Q104) nothing here runs: no journal,
 * no pointer, and the shipped model loads exactly as before.
 */
import { File } from "expo-file-system";
import Constants from "expo-constants";
import {
  SHIPPED_MODEL,
  SMOKE_PROMPT,
  checkManifest,
  recoverUpdate,
  smokePassed,
  stepUpdate,
  type InstalledModel,
  type ManifestVerdict,
  type SignedManifest,
  type UpdateConditions,
  type UpdateEffect,
  type UpdateEvent,
  type UpdateState,
  type UpdateStep,
} from "@hermit/model";
import { HermitNotifications } from "../../modules/hermit-notifications";
import { modelFile, phoneDownload, phoneFacts, resumableBytesOf } from "./device";
import { countedFetch, countOutbound } from "./net";
import { byteCount } from "../platform-facts";

/**
 * Where a signed manifest comes from and the Ed25519 public key (hex) that must have signed it. Both unset
 * in this build: FR-MODEL-02 says new models arrive with an app update that pins their hash (Q104).
 */
export const MODEL_UPDATE_SOURCE: { manifestUrl: string; publicKey: string } | undefined = undefined;

const JOURNAL = "update.json";
const POINTER = "active.json";
const REFUSED = "refused.json";

function readJson<T>(name: string): T | undefined {
  const f = modelFile(name);
  if (!f.exists) return undefined;
  try {
    return JSON.parse(f.textSync()) as T;
  } catch {
    return undefined;
  }
}

/** Write then rename, so a kill leaves either the old content or the new, never half of it. */
function writeJsonAtomic(name: string, value: unknown): void {
  const tmp = modelFile(`${name}.tmp`);
  if (tmp.exists) tmp.delete();
  tmp.write(JSON.stringify(value));
  const target = modelFile(name);
  if (target.exists) target.delete();
  tmp.move(target);
}

/** The model the pointer names, only if its file is in place with the hash it was promoted under. */
export function activeModel(): InstalledModel | undefined {
  const p = readJson<InstalledModel>(POINTER);
  if (!p || typeof p.fileName !== "string" || typeof p.sha256 !== "string") return undefined;
  const file = modelFile(p.fileName);
  const sidecar = modelFile(`${p.fileName}.sha256`);
  return file.exists && sidecar.exists && sidecar.textSync().trim() === p.sha256 ? p : undefined;
}

// Turns and the swap never overlap: the engine counts running completions, and waits while a swap runs. A turn is
// several completions in a row, so one that ended in the last few seconds still counts as the turn going on.
const TURN_GAP_MS = 10_000;
let turns = 0;
let lastEnd = 0;
let swap: Promise<void> | undefined;
export function turnStarted(): () => void {
  turns++;
  return () => {
    turns = Math.max(0, turns - 1);
    lastEnd = Date.now();
  };
}
/** A completion runs, or one ended in the last few seconds: a turn is going on. The engine reloads only outside one. */
export function inTurn(): boolean {
  return turns > 0 || Date.now() - lastEnd < TURN_GAP_MS;
}
export function swapInProgress(): Promise<void> | undefined {
  return swap;
}

type Hooks = {
  /** Unloads the engine so the next turn loads whatever the pointer names. */
  release(): Promise<void>;
  /** Loads `fileUri` and answers one short prompt; the caller closes it. */
  smoke(fileUri: string, prompt: string): Promise<string>;
};
let hooks: Hooks | undefined;
export function setModelUpdateHooks(h: Hooks): void {
  hooks = h;
}

let state: UpdateState = { phase: "idle" };
const listeners = new Set<(s: UpdateState) => void>();
export function modelUpdateState(): UpdateState {
  return state;
}
export function onModelUpdate(l: (s: UpdateState) => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

async function apply(e: UpdateEffect): Promise<UpdateEvent> {
  switch (e.kind) {
    case "download": {
      try {
        const expected = state.phase === "downloading" ? state.manifest.file.size : undefined;
        countOutbound(e.url); // FR-PRIV-02: the model host, for the privacy screen (as the first download)
        await phoneDownload(e.url, e.fileName, e.from, () => {}, expected);
        return { type: "downloaded" };
      } catch {
        return { type: "download_failed", received: resumableBytesOf(e.fileName, e.url) };
      }
    }
    case "verify": {
      // Whatever sits at the final name or in .part is hashed again; only a match is promoted next to its record.
      const final = modelFile(e.fileName);
      const part = modelFile(`${e.fileName}.part`);
      const sidecar = modelFile(`${e.fileName}.sha256`);
      if (sidecar.exists) sidecar.delete();
      if (final.exists) {
        if (part.exists) part.delete();
        final.move(part);
      }
      if (!part.exists) return { type: "verified", size: 0, sha256: "" };
      const sha = (await HermitNotifications.sha256File(part.uri).catch(() => "")).toLowerCase();
      const size = byteCount(part.size);
      const expected = state.phase === "verifying" ? state.manifest.file : undefined;
      if (expected && size === expected.size && sha === expected.sha256) {
        sidecar.write(sha);
        part.move(final);
      }
      return { type: "verified", size, sha256: sha };
    }
    case "flip_pointer":
      writeJsonAtomic(POINTER, e.to);
      return { type: "pointer_flipped" };
    case "self_test": {
      const h = hooks;
      const next = readJson<InstalledModel>(POINTER);
      if (!h || !next) return { type: "self_test", passed: false };
      await h.release();
      const reply = await h.smoke(modelFile(next.fileName).uri, SMOKE_PROMPT).catch(() => undefined);
      return { type: "self_test", passed: smokePassed(reply) };
    }
    case "delete_file": {
      for (const name of [e.fileName, `${e.fileName}.part`, `${e.fileName}.part.resume`, `${e.fileName}.sha256`]) {
        const f = modelFile(name);
        if (f.exists) f.delete();
      }
      return { type: "cleaned" };
    }
  }
}

/** Persist, apply, feed the outcome back; stops when a state has nothing left to do. */
async function run(first: UpdateStep): Promise<void> {
  let cur = first;
  for (;;) {
    state = cur.state;
    writeJsonAtomic(JOURNAL, state);
    for (const l of listeners) l(state);
    if (state.phase === "rolled_back") {
      const refused = readJson<string[]>(REFUSED) ?? [];
      if (!refused.includes(state.version)) writeJsonAtomic(REFUSED, [...refused, state.version]);
    }
    let event: UpdateEvent | undefined;
    // Pointer flips and the self-test hold turns back (the engine waits on swapInProgress); downloads never do.
    const locks = cur.effects.some((e) => e.kind === "flip_pointer" || e.kind === "self_test");
    let release: () => void = () => {};
    if (locks) swap = new Promise<void>((r) => (release = r));
    try {
      for (const e of cur.effects) event = await apply(e);
    } finally {
      if (locks) {
        swap = undefined;
        release();
      }
    }
    // A verified file swaps in only while no turn runs; otherwise it waits staged for the next check.
    if (state.phase === "staged" && !inTurn()) event = { type: "swap", inTurn: false };
    if (!event) return;
    cur = stepUpdate(state, event);
  }
}

/** One update run at a time; a second caller while one runs does nothing (the running one carries on). */
let running = false;
async function exclusive(work: () => Promise<void>): Promise<void> {
  if (running) return;
  running = true;
  try {
    await work();
  } catch {
    // A failed step leaves the journal at its last state; the next launch recovers from it.
  } finally {
    running = false;
  }
}

/** On launch: finishes or rolls back whatever a kill interrupted. No journal (the normal case): nothing. */
export function recoverModelUpdate(): Promise<void> {
  const journal = readJson<UpdateState>(JOURNAL);
  if (!journal) return Promise.resolve();
  state = journal;
  return exclusive(async () => {
    const pointer = readJson<InstalledModel>(POINTER);
    let stagedBytes: number | undefined;
    if (journal.phase === "downloading" || journal.phase === "waiting") {
      const staged = modelFile(`${stagedName(journal)}.part`);
      // iOS has no .part mid-download; its saved resume data says how far it got (#127).
      stagedBytes = staged.exists ? byteCount(staged.size) : resumableBytesOf(stagedName(journal), journal.manifest.file.url) || undefined;
    }
    await run(recoverUpdate(journal, { pointerSha256: pointer?.sha256, stagedBytes }));
  });
}

function stagedName(s: Extract<UpdateState, { phase: "downloading" | "waiting" }>): string {
  return `v${s.manifest.version}-${s.manifest.file.url.split("/").pop()}`;
}

async function conditions(userAsked: boolean): Promise<UpdateConditions> {
  const facts = await phoneFacts().catch(() => ({ network: "none" as const, freeBytes: 0 }));
  let power: { charging: boolean; batteryPercent: number } | undefined;
  try {
    power = HermitNotifications.power();
  } catch {
    power = undefined;
  }
  return {
    inTurn: inTurn(),
    network: facts.network,
    // expo-network can't tell a metered Wi-Fi apart, so cellular is the metered case (Q105).
    metered: facts.network === "cellular",
    batteryPercent: power && Number.isFinite(power.batteryPercent) ? power.batteryPercent : undefined,
    charging: power?.charging === true,
    freeBytes: facts.freeBytes,
    userAsked,
  };
}

/**
 * Asks the pinned source for a signed manifest (through countedFetch, FR-PRIV-02) and starts or resumes an
 * update when the phone allows it. `userAsked` is the "Update now" button: metered data and a low battery
 * stop holding it back; a running turn still does.
 */
export async function checkModelUpdate(userAsked: boolean): Promise<ManifestVerdict | undefined> {
  const source = MODEL_UPDATE_SOURCE;
  if (!source) return undefined;
  if (state.phase === "waiting") {
    const c = await conditions(userAsked);
    await exclusive(() => run(stepUpdate(state, { type: "conditions", conditions: c })));
    return undefined;
  }
  if (state.phase === "staged") {
    await exclusive(() => run(stepUpdate(state, { type: "swap", inTurn: inTurn() })));
    return undefined;
  }
  if (state.phase !== "idle" && state.phase !== "failed" && state.phase !== "rolled_back") return undefined;
  let signed: SignedManifest;
  try {
    const res = await countedFetch(source.manifestUrl, { headers: { accept: "application/json" } });
    if (!res.ok) return undefined;
    signed = (await res.json()) as SignedManifest;
  } catch {
    return undefined;
  }
  const installed = activeModel() ?? SHIPPED_MODEL;
  const verdict = checkManifest(signed, source.publicKey, {
    appVersion: Constants.expoConfig?.version ?? "0.0.0",
    installed,
    refused: readJson<string[]>(REFUSED) ?? [],
  });
  if (verdict.kind !== "offer") return verdict;
  const c = await conditions(userAsked);
  await exclusive(() => run(stepUpdate(state, { type: "offer", manifest: verdict.manifest, previous: installed, conditions: c })));
  return verdict;
}

/** For the file loader: the active model's file name when an update made one active. */
export function activeFile(): File | undefined {
  const a = activeModel();
  return a ? modelFile(a.fileName) : undefined;
}
