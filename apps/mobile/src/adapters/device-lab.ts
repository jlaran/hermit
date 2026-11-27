// HM-SET-10, the Device lab: the phone side. What the phone says about itself, the model loaded with a given plan, the
// thermal status, the screen kept on while the lab runs, and the report copied, shared or opened in the browser.
// Nothing here sends anything: the report leaves the phone only when the person files, copies or shares it.
import Constants from "expo-constants";
import { Linking, Platform, Share } from "react-native";
import type { LabPorts, PhoneFacts } from "@hermit/eval";
import { PROFILES, profileForPlan, type ModelProfile, type RuntimeConditions, type RuntimePlan } from "@hermit/model";
import { HermitNotifications } from "../../modules/hermit-notifications";
import { HermitVault } from "../../modules/hermit-vault";
import { hardwarePlatform, iosLabFacts } from "../platform-facts";
import { allowedCpus, loadPlan, modelFile, thermalNow } from "./device";
import { activeFile } from "./model-update";
import { qvacEngine } from "./qvac-engine";

/** The lab runs every step on the same settings whatever the heat, so its runs compare; the guard pauses instead. */
const NOMINAL: RuntimeConditions = { thermal: "nominal", lowPowerMode: false, memoryPressure: "none" };

const read = <T>(f: () => T): T | undefined => {
  try {
    return f();
  } catch {
    return undefined;
  }
};

/** The app version the report names. */
export function appVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

/**
 * What the report may say about this phone, read once at the start, on screen. Only Build fields that describe the
 * model of phone (never Build.SERIAL, the fingerprint or the device name a person sets), the hardware the runtime
 * already reads, the cores the app may use now, and battery saver. On an iPhone, only what iOS gives (iosLabFacts).
 * Undefined when the hardware can't be read.
 */
export async function labFacts(): Promise<PhoneFacts | undefined> {
  let hw: Awaited<ReturnType<typeof HermitNotifications.hardwareFacts>>;
  try {
    hw = await HermitNotifications.hardwareFacts();
  } catch {
    return undefined;
  }
  const Device: Partial<typeof import("expo-device")> = await import("expo-device").catch(() => ({}));
  if (hardwarePlatform(Platform.OS) === "ios") return iosLabFacts(Device, hw, read(() => thermalNow().powerSave) === true);
  const apiLevel = Device.platformApiLevel ?? (typeof Platform.Version === "number" ? Platform.Version : Number(Platform.Version));
  // A build from before the Device lab has no chipFacts: its hardwareFacts' soc is Build.SOC_MODEL on Android 12 and
  // later, Build.HARDWARE before.
  const chip = read(() => HermitNotifications.chipFacts());
  const now = allowedCpus();
  return {
    manufacturer: Device.manufacturer ?? undefined,
    model: Device.modelName ?? hw.model,
    ...(chip
      ? { socManufacturer: chip.socManufacturer, socModel: chip.socModel, cpuinfoHardware: chip.cpuinfoHardware, buildHardware: chip.hardware }
      : apiLevel >= 31 ? { socModel: hw.soc } : { buildHardware: hw.soc }),
    totalRamBytes: hw.totalRamBytes,
    lowRam: hw.isLowRamDevice,
    androidRelease: Device.osVersion ?? undefined,
    apiLevel,
    abis: Device.supportedCpuArchitectures ?? undefined,
    logicalCores: hw.logicalCores,
    clusters: hw.clusters,
    cpuFeatures: { dotprod: hw.dotprod, i8mm: hw.i8mm, sve2: hw.sve2, sme2: hw.sme2 },
    ...(now ? { allowedCpus: now.cpus, cpuset: now.cpuset } : {}),
    batterySaver: read(() => thermalNow().powerSave) === true,
  };
}

export interface LabSetup {
  /** The shipped profile with this phone's plan (thinking budget, fast route), as the app runs it. */
  profile: ModelProfile;
  /** The plan for the cores the app may use now, on screen. */
  plan: RuntimePlan;
  allowedCores: number | undefined;
  facts: PhoneFacts;
}

/** Everything the lab needs before it starts; undefined when this phone's hardware can't be read. */
export async function labSetup(): Promise<LabSetup | undefined> {
  const [plan, facts] = await Promise.all([loadPlan(), labFacts()]);
  if (!plan || !facts) return undefined;
  return { profile: profileForPlan(PROFILES[0]!, plan), plan, allowedCores: allowedCpus()?.cpus.length, facts };
}

/** The phone for runDeviceLab: the model (the verified file the app itself would load), the thermal status, a timer. */
export function labPorts(profile: ModelProfile): LabPorts {
  const name = profile.file.url.split("/").pop()!;
  return {
    load: (plan) => qvacEngine((activeFile() ?? modelFile(name)).uri, profile, { plan, conditions: () => NOMINAL }),
    thermal: () => read(() => thermalNow().status),
    sleep: (ms, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        signal.addEventListener("abort", done, { once: true });
      }),
    now: () => Date.now(),
  };
}

/** Battery saver now, for the note before the lab starts. */
export function batterySaverOn(): boolean {
  return read(() => thermalNow().powerSave) === true;
}

/** The screen stays on while the lab runs (a window flag). A build without the call keeps the phone's own timeout. */
export async function keepScreenOn(on: boolean): Promise<void> {
  try {
    await HermitNotifications.keepScreenOn(on);
  } catch {
    // An older build has no such call: the phone's own screen timeout applies.
  }
}

/** The report as a plain clip: it holds nothing secret (the same way a wallet address is copied). */
export function copyReport(text: string): Promise<void> {
  return HermitVault.copyPlain(text);
}

/** Android's share sheet with the report's text; the person picks where it goes, or nowhere. */
export async function shareReport(text: string, subject: string): Promise<void> {
  await Share.share({ message: text, title: subject });
}

/** Opens the GitHub form with the system's default handler: the GitHub app when installed, else the browser. Nothing is filed until the person submits it there. */
export function openReportForm(url: string): Promise<void> {
  return Linking.openURL(url);
}
