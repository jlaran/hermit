import { Directory, DownloadTask, File, Paths } from "expo-file-system";
import * as Network from "expo-network";
import { AppState, Linking, Platform } from "react-native";
import { allowedCpuSet, cpuListText, initialPlan, threadPlan, threadsReload, withThreads, type HardwareFacts, type RuntimePlan, type ThreadPlan } from "@hermit/model";
import { HermitNotifications } from "../../modules/hermit-notifications";
import { pausesFor, readResumeRecord, resumableBytes, resumePlan, resumeRecordText, type ResumeRecord } from "../download-resume";
import { nightDeviceState, type NightDeviceState } from "../night-device";
import { byteCount, hardwareFactsFor, hardwarePlatform, thermalFromNative, type NativeThermal } from "../platform-facts";
import { observedTokensPerSecond } from "./qvac-engine";

/** Calls back when the phone comes back online, so an interrupted download can resume. Returns unsubscribe. */
export function onReconnect(listener: () => void): () => void {
  const sub = Network.addNetworkStateListener((s) => {
    if (s.isConnected) listener();
  });
  return () => sub.remove();
}

/** The model download running now, so it can be paused to keep its iOS resume data. */
let active: DownloadTask | undefined;

/**
 * iOS (#127): pauses the running model download when the app goes to the background or the connection drops, so
 * NSURLSession's resume data is saved next to `.part` and the next attempt picks up from it. expo-file-system hands
 * the resume data back only from a pause, never from a failure. Does nothing on Android, which keeps `.part` on disk.
 * Returns unsubscribe.
 */
export function pauseDownloadWhenLeaving(): () => void {
  const pause = (signal: { appState?: string; connected?: boolean }) => {
    if (pausesFor(Platform.OS, signal) && active?.state === "active") void active.pauseAsync().catch(() => {});
  };
  const app = AppState.addEventListener("change", (appState) => pause({ appState }));
  const net = Network.addNetworkStateListener((s) => pause({ connected: s.isConnected }));
  return () => {
    app.remove();
    net.remove();
  };
}

/** Android's storage page (EC-ONB-03), falling back to the app's own settings page. */
export async function openStorageSettings(): Promise<void> {
  try {
    await Linking.sendIntent("android.settings.INTERNAL_STORAGE_SETTINGS");
  } catch {
    await Linking.openSettings();
  }
}

/** Network type and free space for the download rules (US-ONB-03). */
export async function phoneFacts(): Promise<{ network: "wifi" | "cellular" | "none"; freeBytes: number }> {
  const s = await Network.getNetworkStateAsync();
  const network = !s.isConnected ? "none" : s.type === Network.NetworkStateType.WIFI || s.type === Network.NetworkStateType.ETHERNET ? "wifi" : "cellular";
  return { network, freeBytes: byteCount(Paths.availableDiskSpace) };
}

const CHUNK = 4 * 1024 * 1024;

/** The model file's home: app documents (not cache, which the system may clear). */
export function modelFile(name: string): File {
  const dir = new Directory(Paths.document, "models");
  if (!dir.exists) dir.create();
  return new File(dir, name);
}

/** The hash recorded when a file was promoted after its SHA-256 matched. */
export function verifiedSha256(name: string): string | undefined {
  const final = modelFile(name);
  const sidecar = modelFile(`${name}.sha256`);
  return final.exists && sidecar.exists ? sidecar.textSync().trim() : undefined;
}

/**
 * Bytes of an unverified download left on disk (EC-ONB-04: the app was killed or the phone restarted).
 * A model in place without its verification record goes back to `.part` first, so it is hashed again
 * before it can ever load; it is never trusted as is.
 */
export function partialBytes(name: string, url: string): number {
  const final = modelFile(name);
  const part = modelFile(`${name}.part`);
  const sidecar = modelFile(`${name}.sha256`);
  if (final.exists && !sidecar.exists) {
    if (part.exists) part.delete();
    final.move(part);
  }
  return resumableBytesOf(name, url);
}

/** iOS: NSURLSession's resume data for `<name>.part`, saved when the download paused (#127). */
const resumeFile = (name: string) => modelFile(`${name}.part.resume`);

/** The saved resume data for this URL, when it is there and well formed; never throws. */
function savedResume(name: string, url: string, size?: number): ResumeRecord | undefined {
  try {
    const f = resumeFile(name);
    return f.exists ? readResumeRecord(f.textSync(), url, size) : undefined;
  } catch {
    return undefined;
  }
}

/** Bytes a download of `<name>` can resume from: `.part` on disk, or on iOS the saved resume data. Moves nothing. */
export function resumableBytesOf(name: string, url: string): number {
  const part = modelFile(`${name}.part`);
  return resumableBytes(Platform.OS, part.exists ? byteCount(part.size) : 0, savedResume(name, url));
}

/**
 * Resumable HTTPS download into `<name>.part`; the bytes in chunks for SHA-256; and promote(), which
 * moves the file to its final name. Only a promoted file is ever loaded (FR-MODEL-02), so an interrupted
 * download or a crash before the check can never be mistaken for a verified model.
 *
 * `from` comes from the screen's state machine (`downloading.from`): 0 deletes any partial file and
 * starts clean (a retry after a failed check, US-ONB-07); more than 0 resumes from that byte with an
 * HTTP Range request (lost connection, full disk, app killed). A failed attempt keeps `.part` so the
 * next one can resume; only discard() (after a hash mismatch) deletes it.
 *
 * iOS (#127) writes `.part` only once the file is complete, and resumes from the resume data NSURLSession
 * produced when the task paused, saved in `<name>.part.resume`; see download-resume.ts for which path runs.
 */
export async function phoneDownload(url: string, name: string, from: number, onProgress: (received: number) => void, expectedSize?: number) {
  const final = modelFile(name);
  const part = modelFile(`${name}.part`);
  const sidecar = modelFile(`${name}.sha256`);
  const saved = resumeFile(name);
  // Whatever sits at the final name is not trusted by a new attempt: back to .part, record removed.
  if (final.exists) {
    if (part.exists) part.delete();
    final.move(part);
  }
  if (sidecar.exists) sidecar.delete();
  const record = savedResume(name, url, expectedSize);
  // Resume data is used once: a resumed task that pauses again saves a fresh record, so a stale one never lingers.
  if (saved.exists) saved.delete();
  const plan = resumePlan(Platform.OS, { from, partBytes: part.exists ? byteCount(part.size) : 0, expectedSize, record });
  if (plan.kind === "clean" && part.exists) part.delete();
  let received = 0;
  const onBytes = {
    onProgress: ({ bytesWritten }: { bytesWritten: number | bigint }) => {
      received = byteCount(bytesWritten);
      onProgress(received);
    },
  };
  const restored = (resumeData: string) => DownloadTask.fromSavable({ url, fileUri: part.uri, isDirectory: false, resumeData }, onBytes);
  let task: DownloadTask | undefined;
  let file: File | null;
  try {
    if (plan.kind === "complete") {
      // Complete already: go straight to the check, which still runs.
      onProgress(byteCount(part.size));
      file = part;
    } else if (plan.kind === "range") {
      // Android resume data is the byte offset; the native task truncates to it and appends (Range).
      file = await (task = active = restored(String(plan.offset))).resumeAsync();
    } else if (plan.kind === "resume_data") {
      // iOS: NSURLSession's own resume data from the pause. If it is rejected (stale, or the system cleared the
      // bytes it kept), one clean restart from zero instead, so a bad record never blocks the download.
      received = plan.offset;
      onProgress(plan.offset);
      try {
        file = await (task = active = restored(plan.resumeData)).resumeAsync();
      } catch {
        received = 0;
        onProgress(0);
        file = await (task = active = File.createDownloadTask(url, part, onBytes)).downloadAsync();
      }
    } else {
      file = await (task = active = File.createDownloadTask(url, part, onBytes)).downloadAsync();
    }
  } finally {
    if (active === task) active = undefined;
  }
  // iOS keeps nothing in .part until the end: a pause saves NSURLSession's resume data next to it instead.
  if (!file && task?.state === "paused" && Platform.OS === "ios") {
    const text = resumeRecordText(url, task.savable().resumeData, received);
    if (text) saved.write(text);
  }
  if (!file) throw new Error("download paused"); // .part (Android) or its resume data (iOS) stays for the next resume
  return {
    /** Native streamed SHA-256 (seconds, off the JS thread); the JS chunks() path stays for tests and fallback. */
    sha256: () => HermitNotifications.sha256File(file.uri),
    /** Called only after the SHA-256 matched: records that hash next to the file, then moves it into place. */
    async promote(sha256: string) {
      sidecar.write(sha256);
      file.move(final);
    },
    async *chunks(): AsyncIterable<Uint8Array> {
      const h = file.open();
      try {
        for (;;) {
          const bytes = await h.readBytes(CHUNK);
          if (!bytes.length) break;
          yield bytes;
        }
      } finally {
        h.close();
      }
    },
    async discard() {
      if (file.exists) file.delete();
    },
  };
}

/** Device-adaptive runtime: what this phone is (read once; nothing leaves the phone). */
export async function hardwareFacts(): Promise<HardwareFacts | undefined> {
  try {
    const h = await HermitNotifications.hardwareFacts();
    return hardwareFactsFor(Platform.OS, h, allowedCpuSet(h.allowedCpus));
  } catch {
    return undefined; // older build without the function: the profile's own runtime applies
  }
}

/**
 * The cores this process may run on right now and the cpuset it is in (two small /proc reads). Android moves the app
 * between cpusets as it comes and goes, so this is read right before the model loads and at each safe point. Undefined
 * when unreadable, or on a build from before 2026-11-24 without the call.
 */
export function allowedCpus(): { cpus: number[]; cpuset: string } | undefined {
  try {
    const a = HermitNotifications.allowedCpus();
    const cpus = allowedCpuSet(a.cpus);
    return cpus ? { cpus, cpuset: a.cpuset || "unknown" } : undefined;
  } catch {
    return undefined;
  }
}

/** The thermal reading on Android's THERMAL_STATUS_* scale on every platform (iOS maps its ThermalState). Throws as the module does. */
export function thermalNow(): NativeThermal {
  return thermalFromNative(Platform.OS, HermitNotifications.thermal());
}

/** Current heat and battery conditions, mapped to the runtime's levels (Android THERMAL_STATUS_*). */
/** The S26 generates 40 to 50 tok/s when free; under 10 something is starving the model, under 3 it is paging. */
export function pressureFromSpeed(tps: number | undefined): "none" | "moderate" | "critical" {
  if (tps === undefined) return "none";
  return tps < 3 ? "critical" : tps < 10 ? "moderate" : "none";
}

export function runtimeConditions(): import("@hermit/model").RuntimeConditions {
  try {
    const t = thermalNow();
    const thermal = t.status >= 4 ? "critical" : t.status === 3 ? "serious" : t.status >= 1 ? "fair" : "nominal";
    return { thermal, ...(Number.isFinite(t.headroom) && t.headroom > 0 ? { thermalHeadroom: t.headroom } : {}), lowPowerMode: t.powerSave, memoryPressure: pressureFromSpeed(observedTokensPerSecond()) };
  } catch {
    return { thermal: "nominal", lowPowerMode: false, memoryPressure: "none" };
  }
}

/** SL-24: the night shift's guards now (charging, battery, heat, screen, network). Fails closed on any error. */
export async function nightConditions(): Promise<NightDeviceState> {
  const read = <T>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const network = await phoneFacts().then((f) => f.network, () => "none" as const);
  return nightDeviceState(read(() => HermitNotifications.power()), read(() => thermalNow()), network);
}

let factsOnce: Promise<HardwareFacts | undefined> | undefined;
let facts: HardwareFacts | undefined;
/** This phone's hardware, read once (its allowed cores are the launch's; every load reads them again). */
function phoneHardware(): Promise<HardwareFacts | undefined> {
  factsOnce ??= hardwareFacts().then((f) => (facts = f));
  return factsOnce;
}

let planOnce: Promise<RuntimePlan | undefined> | undefined;
/**
 * This phone's runtime plan, from its hardware (rules today; calibration refines it later). Read once, for the tier
 * and the budgets the profile takes; the model's threads come from the cores allowed when it loads (loadPlan).
 */
export function devicePlan(): Promise<RuntimePlan | undefined> {
  planOnce ??= phoneHardware().then((f) => (f ? initialPlan(f) : undefined));
  return planOnce;
}

/** One log line for the phone checks: the cpuset, the cores it allows and the threads that run on them. */
function coresLine(now: { cpus: number[]; cpuset: string } | undefined, t: ThreadPlan): string {
  return `cpuset ${now?.cpuset ?? "unknown"}, allowed ${cpuListText(now?.cpus)}, threads ${t.threads}, batch ${t.threadsBatch}, mask ${t.cpuMask ?? "none"}`;
}

/**
 * The plan to load the model with now: the device plan with the threads for the cores this process may use at this
 * moment (Android's cpuset: on the S26, 5 on screen and 3 in the background, so the night shift loads with the
 * background count). Cores that can't be read get the stopgap's count (threadPlan).
 */
export async function loadPlan(): Promise<RuntimePlan | undefined> {
  const [f, base] = await Promise.all([phoneHardware(), devicePlan()]);
  if (!f || !base) return undefined;
  if (f.platform !== "android") return base; // no cpusets to follow
  const now = allowedCpus();
  const plan = withThreads(base, threadPlan(f, now?.cpus));
  console.log(`[hermit:threads] load: ${coresLine(now, plan)}`);
  return plan;
}

/**
 * At a safe point (a turn starts and nothing runs on the model): the plan to load again with when the cores allowed now
 * call for other threads than the engine has (the app went to the background and its set shrank below them, or it
 * came back). Undefined keeps the engine, also when the cores can't be read.
 */
export function reloadPlan(loaded: RuntimePlan): RuntimePlan | undefined {
  if (!facts) return undefined;
  const now = allowedCpus();
  const t = threadsReload(loaded, facts, now?.cpus);
  if (!t) return undefined;
  console.log(`[hermit:threads] reload at a safe point: ${coresLine(now, t)} (was ${loaded.threads} threads)`);
  return withThreads(loaded, t);
}

/**
 * SL-43: what the floor check reads (US-ONB-06, NFR-05), before any download. expo-device gives the Android
 * version, the ABIs, the memory and the maker; the native module adds dot product and Android Go. Anything
 * unreadable stays undefined, and the rules never block on a missing fact.
 */
export async function floorFacts(): Promise<import("@hermit/model").FloorFacts> {
  const hw = await hardwareFacts();
  // Loaded here, not at the top: a missing native module only leaves these facts unknown (never blocking).
  const Device: Partial<typeof import("expo-device")> = await import("expo-device").catch(() => ({}));
  return {
    platform: hardwarePlatform(Platform.OS),
    apiLevel: Device.platformApiLevel ?? undefined,
    abis: Device.supportedCpuArchitectures ?? undefined,
    totalRamBytes: hw?.totalRamBytes ?? Device.totalMemory ?? undefined,
    isLowRamDevice: hw?.isLowRamDevice,
    dotprod: hw?.cpuFeatures.dotprod,
    manufacturer: Device.manufacturer ?? undefined,
    model: Device.modelName ?? hw?.model,
    soc: hw?.soc,
  };
}
