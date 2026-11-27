// HM-SET-10, the Device lab: what the screen shows, made from the report alone, and the link that opens the GitHub
// form with the report filled in. Pure: tested under Node with node --test (device-lab-view.test.ts).
import type { DeviceReport } from "@hermit/eval";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface ReportRow {
  label: string;
  value: string;
}

export interface ReportGroup {
  title: string;
  rows: ReportRow[];
}

/** The project's report form: an issue form (.github/ISSUE_TEMPLATE/device_report.yml) whose fields take query values. */
export const REPORT_FORM_URL = "https://github.com/DojoCodingLabs/hermit/issues/new";
/** For the screen, where a link can't open. */
export const REPORT_FORM_ADDRESS = "github.com/DojoCodingLabs/hermit/issues";
/** GitHub refuses very long addresses; past this the report is copied and the empty form opens. */
export const MAX_FORM_URL = 6000;

/** The exact text that Copy, Share and File it on GitHub use. */
export function reportText(r: DeviceReport): string {
  return JSON.stringify(r, null, 2);
}

/** The form with the report filled in when it fits in a link (pretty, else compact); else the empty form. */
export function issueLink(r: DeviceReport): { url: string; prefilled: boolean } {
  const base = `${REPORT_FORM_URL}?template=device_report.yml&title=${encodeURIComponent(`Device report: ${r.device.manufacturer} ${r.device.model}`)}`;
  for (const text of [reportText(r), JSON.stringify(r)]) {
    const url = `${base}&report=${encodeURIComponent(text)}`;
    if (url.length <= MAX_FORM_URL) return { url, prefilled: true };
  }
  return { url: base, prefilled: false };
}

/** What the screen says after File it on GitHub. */
export type FileNotice = "fileCopied" | "longCopied" | "copyFailed" | "openFailed";

/**
 * File it on GitHub: the exact report goes to the clipboard first, every time, then the system opens the link with
 * whatever handles github.com (the GitHub app when installed, else the browser). The app may drop the link's query, so
 * the copy is what lets the report reach the form either way. When the copy fails, a filled-in form still opens; an
 * empty one doesn't, since the person would have nothing to paste.
 */
export async function fileReport(r: DeviceReport, io: { copy(text: string): Promise<void>; open(url: string): Promise<void> }): Promise<FileNotice | undefined> {
  const link = issueLink(r);
  let copied = true;
  try {
    await io.copy(reportText(r));
  } catch {
    copied = false;
    if (!link.prefilled) return "copyFailed";
  }
  try {
    await io.open(link.url);
  } catch {
    return "openFailed";
  }
  return !copied ? undefined : link.prefilled ? "fileCopied" : "longCopied";
}

/** Minutes and seconds, for the time so far ("1:05"). */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const FEATURES = ["dotprod", "i8mm", "sve2", "sme2"] as const;

/** Every part of the report in plain words, group by group: what the person would share, before they share it. */
export function reportGroups(r: DeviceReport, t: Translate, locale: string): ReportGroup[] {
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const rate = (tps: number) => t("HM-SET-10.rateValue", { tps: one.format(tps) });
  const sec = (ms: number) => one.format(ms / 1000);
  const row = (label: string, value: string): ReportRow => ({ label: t(label), value });
  const d = r.device;
  const rt = r.runtime;

  // Equal clocks side by side read as one group: "4 at 2.0 GHz, 3 at 2.6 GHz".
  const clocks: string[] = [];
  const mhzs = d.platform === "android" ? (d.coreMaxMHz ?? []) : [];
  for (let i = 0; i < mhzs.length; ) {
    const mhz = mhzs[i]!;
    let n = 0;
    while (mhzs[i + n] === mhz) n++;
    clocks.push(mhz > 0 ? t("HM-SET-10.clockGroup", { count: n, ghz: one.format(mhz / 1000) }) : t("HM-SET-10.clockUnread", { count: n }));
    i += n;
  }
  const features = FEATURES.filter((f) => d.cpuFeatures[f]);
  const memory = row("HM-SET-10.memory", t(d.platform === "android" && d.lowRam ? "HM-SET-10.memoryLow" : "HM-SET-10.memoryValue", { gb: one.format(d.ramGB) }));
  // An iPhone has no chip name, API level or ABI to show; its model identifier says which iPhone it is.
  const system =
    d.platform === "ios"
      ? [row("HM-SET-10.modelId", d.modelId), memory, row("HM-SET-10.ios", d.ios), row("HM-SET-10.processor", t("HM-SET-10.processorCores", { cores: d.cores }))]
      : [
        row("HM-SET-10.chip", d.chipVendor ? `${d.chipVendor} ${d.chip}` : d.chip),
        memory,
        row("HM-SET-10.android", t("HM-SET-10.androidValue", { version: d.android, api: d.api })),
        row("HM-SET-10.processor", t("HM-SET-10.processorValue", { cores: d.cores, abi: d.abi })),
      ];
  const phone = [
    row("HM-SET-10.phone", `${d.manufacturer} ${d.model}`),
    ...system,
    ...(clocks.length ? [row("HM-SET-10.clocks", clocks.join(", "))] : []),
    row("HM-SET-10.features", features.length ? features.join(", ") : t("HM-SET-10.featuresNone")),
  ];

  const settings = [
    t("HM-SET-10.settingContext", { tokens: whole.format(rt.ctxSize) }),
    t("HM-SET-10.settingBatch", { size: whole.format(rt.ubatch) }),
    t("HM-SET-10.settingBatchThreads", { threads: rt.threadsBatch }),
    rt.thinkingBudget > 0 ? t("HM-SET-10.settingThinking", { tokens: whole.format(rt.thinkingBudget) }) : t("HM-SET-10.settingNoThinking"),
    ...(rt.fastRoute ? [t("HM-SET-10.settingFastRoute")] : []),
    ...(rt.cpuMask ? [t("HM-SET-10.settingMask", { mask: rt.cpuMask })] : []),
  ].join(", ");
  const plan = [
    row("HM-SET-10.plan", t("HM-SET-10.planValue", { threads: rt.threads, tier: t(`HM-SET-10.tier.${rt.tier}`) })),
    row("HM-SET-10.allowed", rt.allowedCpus === "unknown" ? t("HM-SET-10.unknown") : rt.cpuset ? t("HM-SET-10.allowedValue", { cpus: rt.allowedCpus, cpuset: rt.cpuset }) : rt.allowedCpus),
    row("HM-SET-10.settings", settings.charAt(0).toLocaleUpperCase(locale) + settings.slice(1)),
    row("HM-SET-10.heat", t("HM-SET-10.heatValue", { start: t(`HM-SET-10.thermal.${rt.thermalStart}`), max: t(`HM-SET-10.thermal.${rt.thermalMax}`) })),
    row("HM-SET-10.batterySaverLabel", t(rt.batterySaver ? "HM-SET-10.on" : "HM-SET-10.off")),
  ];

  const s = r.speed;
  const speed = [
    row("HM-SET-10.writing", t("HM-SET-10.writingValue", { tps: one.format(s.tokensPerSecond), threads: s.threads })),
    ...(s.prefillTokensPerSecond !== undefined ? [row("HM-SET-10.reading", rate(s.prefillTokensPerSecond))] : []),
    row("HM-SET-10.firstToken", t("HM-SET-10.secondsValue", { seconds: sec(s.firstTokenMs) })),
    row("HM-SET-10.loadTime", t("HM-SET-10.secondsValue", { seconds: sec(s.loadMs) })),
    ...s.sweep.map((w) => ({
      label: t("HM-SET-10.threadsAt", { threads: w.threads }),
      value: [
        t("HM-SET-10.sweepWriting", { tps: one.format(w.tokensPerSecond) }),
        ...(w.prefillTokensPerSecond !== undefined ? [t("HM-SET-10.sweepReading", { tps: one.format(w.prefillTokensPerSecond) })] : []),
        w.firstTokenMs !== undefined ? t("HM-SET-10.sweepFirst", { seconds: sec(w.firstTokenMs) }) : t("HM-SET-10.sweepNoToken"),
        t("HM-SET-10.sweepLoad", { seconds: sec(w.loadMs) }),
      ].join(", "),
    })),
  ];

  const e = r.eval;
  const accuracy = [
    row("HM-SET-10.correct", t("HM-SET-10.correctValue", { score: e.score, n: e.n })),
    row("HM-SET-10.median", t("HM-SET-10.secondsValue", { seconds: sec(e.firstActionMedianMs) })),
    row("HM-SET-10.p90", t("HM-SET-10.secondsValue", { seconds: sec(e.p90Ms) })),
    ...(e.perCase ?? []).map((c) => ({
      label: c.id,
      value: c.pass ? t("HM-SET-10.caseRight", { seconds: sec(c.ms) }) : t("HM-SET-10.caseWrong", { seconds: sec(c.ms), action: c.choice }),
    })),
  ];

  const run = r.run;
  const total = Math.round(run.durationMs / 1000);
  const paused = whole.format(Math.round(run.pausedMs / 1000));
  const runRows = [
    row("HM-SET-10.duration", t("HM-SET-10.durationValue", { minutes: Math.floor(total / 60), seconds: total % 60 })),
    row("HM-SET-10.pauses", run.thermalPauses === 0 ? t("HM-SET-10.pausesNone") : run.thermalPauses === 1 ? t("HM-SET-10.pausesValue.one", { seconds: paused }) : t("HM-SET-10.pausesValue", { count: run.thermalPauses, seconds: paused })),
    row("HM-SET-10.date", run.date),
    row("HM-SET-10.version", t("HM-SET-10.versionValue", { app: r.app, model: r.model })),
  ];

  return [
    { title: t("HM-SET-10.groupPhone"), rows: phone },
    { title: t("HM-SET-10.groupPlan"), rows: plan },
    { title: t("HM-SET-10.groupSpeed"), rows: speed },
    { title: t("HM-SET-10.groupEval"), rows: accuracy },
    { title: t("HM-SET-10.groupRun"), rows: runRows },
  ];
}
