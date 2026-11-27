// HM-SET-10: the Device lab (Settings, then Device lab). It measures how fast and how accurately Hermit runs on this
// phone, offline, and builds a report with device and benchmark facts only (docs/devices.md, the schema in
// docs/devices/schema.json). States: ready (what it does; no model yet; neither Android nor iOS), running (the step, a meter, the
// time so far and Stop; paused while the phone is hot), stopped, failed (why), and the report: in plain words first,
// then the exact text, then File it on GitHub, Copy and Share. Nothing leaves the phone unless the person does one of
// those. Leaving the screen stops a run: in the background Android gives the app fewer cores.
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, View } from "react-native";
import { buildDeviceReport, LAB_CASES, labSteps, runDeviceLab, stopper, type DeviceReport, type LabFailure, type LabProgress } from "@hermit/eval";
import { PROFILES } from "@hermit/model";
import { modelReady, releaseModel } from "../adapters";
import { appVersion, batterySaverOn, copyReport, keepScreenOn, labPorts, labSetup, openReportForm, shareReport } from "../adapters/device-lab";
import { inTurn } from "../adapters/model-update";
import { Btn, Card, Failed, Field, Label, Meter, Note, Notice, Page, T } from "../components/kit";
import { clockText, fileReport, REPORT_FORM_ADDRESS, type FileNotice, reportGroups, reportText } from "../device-lab-view";
import { currentLocale, t } from "../i18n";
import { s } from "../theme";
import { usePalette } from "../use-palette";

type Failure = LabFailure | "left" | "facts" | "unknown";

type State =
  | { kind: "ready" }
  | { kind: "running"; startedAt: number; steps?: number; progress?: LabProgress }
  | { kind: "stopped" }
  | { kind: "failed"; reason: Failure }
  | { kind: "done"; report: DeviceReport };

type Shared = "copied" | FileNotice;

export default function DeviceLab() {
  usePalette();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "ready" });
  const [pre, setPre] = useState<{ model: boolean; batterySaver: boolean }>();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const stop = useRef<ReturnType<typeof stopper> | undefined>(undefined);
  const left = useRef(false);

  useFocusEffect(useCallback(() => {
    setPre({ model: modelReady(PROFILES[0]!.file), batterySaver: batterySaverOn() });
  }, []));

  // Leaving the app or the screen stops a run, and says why.
  useEffect(() => {
    const leave = () => {
      if (!stop.current) return;
      left.current = true;
      stop.current.abort();
    };
    const sub = AppState.addEventListener("change", (next) => next === "background" && leave());
    return () => {
      sub.remove();
      leave();
    };
  }, []);

  useEffect(() => {
    if (state.kind !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.kind]);

  const start = async () => {
    if (stop.current) return;
    // A turn in the chat holds the model; the lab waits for it to end.
    if (inTurn()) return setBusy(true);
    setBusy(false);
    const run = stopper();
    stop.current = run;
    left.current = false;
    setNow(Date.now());
    setState({ kind: "running", startedAt: Date.now() });
    await keepScreenOn(true);
    try {
      // The chat's model goes first: two models at once would need twice the memory. The next turn loads it again.
      await releaseModel();
      const setup = await labSetup();
      if (!setup) return setState({ kind: "failed", reason: "facts" });
      const steps = labSteps(setup.plan.threads, setup.allowedCores);
      setState((cur) => (cur.kind === "running" ? { ...cur, steps } : cur));
      const lab = await runDeviceLab({
        profile: setup.profile,
        plan: setup.plan,
        allowedCores: setup.allowedCores,
        ports: labPorts(setup.profile),
        signal: run.signal,
        onProgress: (progress) => setState((cur) => (cur.kind === "running" ? { ...cur, progress, steps: progress.steps } : cur)),
      });
      setState({ kind: "done", report: buildDeviceReport({ app: appVersion(), profile: setup.profile, facts: setup.facts, lab }) });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (run.signal.aborted || name === "LabStopped") setState(left.current ? { kind: "failed", reason: "left" } : { kind: "stopped" });
      else if (name === "LabFailed") setState({ kind: "failed", reason: (err as { reason: LabFailure }).reason });
      else setState({ kind: "failed", reason: "unknown" });
    } finally {
      stop.current = undefined;
      await keepScreenOn(false);
    }
  };

  // The lab runs on Android phones and iPhones; each report names its platform, so both can be filed.
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    return (
      <Page title={t("HM-SET-10.title")}>
        <T v="body">{t("HM-SET-10.androidOnly")}</T>
      </Page>
    );
  }

  if (state.kind === "running") return <Running state={state} now={now} onStop={() => stop.current?.abort()} />;
  if (state.kind === "done") return <Report report={state.report} onAgain={() => setState({ kind: "ready" })} />;

  const noModel = pre !== undefined && !pre.model;
  return (
    <Page title={t("HM-SET-10.title")}>
      <T v="body">{t("HM-SET-10.intro")}</T>
      {state.kind === "stopped" ? <Notice text={t("HM-SET-10.stopped")} tone="info" /> : null}
      {state.kind === "failed" ? <Failed text={t(`HM-SET-10.failed.${state.reason}`)} /> : null}

      <Label>{t("HM-SET-10.whatTitle")}</Label>
      <Card style={{ gap: s.md }}>
        <Note icon="smartphone" text={t("HM-SET-10.whatFacts")} textColor="text" />
        <Note icon="sliders-horizontal" text={t("HM-SET-10.whatSpeed")} textColor="text" />
        <Note icon="list-checks" text={t("HM-SET-10.whatEval", { count: LAB_CASES.length })} textColor="text" />
        <Note icon="sun" text={t("HM-SET-10.keepOpen")} textColor="text" />
      </Card>

      {pre?.batterySaver ? (
        <Card tone="amber" style={{ marginTop: s.md }}>
          <Note icon="triangle-alert" tone="amber" text={t("HM-SET-10.batterySaver")} textColor="text" />
        </Card>
      ) : null}

      <View style={{ marginTop: s.xl, gap: s.md }}>
        {noModel ? (
          <>
            <T v="body" role="text">{t("HM-SET-10.noModel")}</T>
            <Btn label={t("HM-SET-10.download")} icon="download" full onPress={() => router.push("/download")} />
          </>
        ) : (
          <Btn label={t(state.kind === "ready" ? "HM-SET-10.start" : "HM-SET-10.again")} icon="play" full disabled={pre === undefined} onPress={() => void start()} />
        )}
        {busy ? <Notice text={t("HM-SET-10.busy")} tone="info" /> : null}
      </View>
    </Page>
  );
}

/** The step, a meter of the steps done, the time so far, and Stop. While the phone is hot, the pause says so. */
function Running({ state, now, onStop }: { state: Extract<State, { kind: "running" }>; now: number; onStop(): void }) {
  const p = state.progress;
  const steps = state.steps ?? p?.steps;
  const paused = p?.phase === "paused";
  const what = !p ? t("HM-SET-10.preparing") : p.phase === "speed" ? t("HM-SET-10.stepSpeed", { threads: p.threads }) : p.phase === "eval" ? t("HM-SET-10.stepCase", { index: p.index, count: p.count }) : undefined;
  return (
    <Page title={t("HM-SET-10.title")}>
      <Card style={{ gap: s.md }}>
        <View accessibilityLiveRegion="polite" style={{ gap: s.xs }}>
          {p && steps ? <T v="footnoteStrong" color="soft">{t("HM-SET-10.progress", { step: p.step, steps })}</T> : null}
          {paused ? <Note icon="triangle-alert" tone="amber" text={t("HM-SET-10.paused")} textColor="text" v="body" /> : <T v="bodyStrong">{what}</T>}
        </View>
        <Meter used={p ? Math.max(0, p.step - 1) : 0} cap={steps ?? 1} />
        <T v="small" color="soft" tabular>{t("HM-SET-10.elapsed", { time: clockText(now - state.startedAt) })}</T>
      </Card>
      <T v="small" color="soft" style={{ marginTop: s.lg, paddingHorizontal: s.lg }}>{t("HM-SET-10.keepOpen")}</T>
      <T v="small" color="soft" style={{ marginTop: s.sm, paddingHorizontal: s.lg }}>{t("HM-SET-10.leaveNote")}</T>
      <View style={{ marginTop: s.xl }}>
        <Btn label={t("HM-SET-10.stop")} kind="coralOutline" icon="x" full onPress={onStop} />
      </View>
    </Page>
  );
}

/** The report in plain words, then the exact text, then the three ways to share it. */
function Report({ report, onAgain }: { report: DeviceReport; onAgain(): void }) {
  const [exact, setExact] = useState(false);
  const [shared, setShared] = useState<Shared>();
  const text = reportText(report);
  const groups = reportGroups(report, t, currentLocale());

  const copy = async () => {
    try {
      await copyReport(text);
      setShared("copied");
    } catch {
      setShared("copyFailed");
    }
  };
  const file = async () => {
    setShared(undefined);
    setShared(await fileReport(report, { copy: copyReport, open: openReportForm }));
  };
  const share = async () => {
    try {
      await shareReport(text, t("HM-SET-10.shareSubject"));
    } catch {
      // The sheet closed or couldn't open; nothing was sent.
    }
  };
  const notice = shared === "openFailed" ? t("HM-SET-10.openFailed", { address: REPORT_FORM_ADDRESS }) : shared ? t(`HM-SET-10.${shared}`) : undefined;

  return (
    <Page title={t("HM-SET-10.reportTitle")}>
      <T v="body" color="soft">{t("HM-SET-10.reportIntro")}</T>
      {groups.map((g) => (
        <View key={g.title}>
          <Label>{g.title}</Label>
          <Card style={{ paddingVertical: s.sm }}>
            {g.rows.map((r, i) => <Field key={`${i}-${r.label}`} label={r.label} value={r.value} />)}
          </Card>
        </View>
      ))}

      <Label>{t("HM-SET-10.neverTitle")}</Label>
      <Card tone="hermit">
        <Note icon="shield-check" text={t("HM-SET-10.never")} textColor="text" />
      </Card>

      <View style={{ marginTop: s.lg, gap: s.sm }}>
        <Btn label={t(exact ? "HM-SET-10.hideExact" : "HM-SET-10.showExact")} kind="text" icon={exact ? "chevron-up" : "chevron-down"} onPress={() => setExact(!exact)} />
        {exact ? (
          <Card style={{ gap: s.sm }}>
            <T v="small" color="soft">{t("HM-SET-10.exactNote")}</T>
            <T v="monoSmall" selectable>{text}</T>
          </Card>
        ) : null}
      </View>

      <Label>{t("HM-SET-10.shareTitle")}</Label>
      <T v="small" color="soft" style={{ marginBottom: s.md, paddingHorizontal: s.lg }}>{t("HM-SET-10.shareBody")}</T>
      <View style={{ gap: s.sm }}>
        <Btn label={t("HM-SET-10.file")} icon="arrow-up-right" full onPress={() => void file()} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: s.sm }}>
          <Btn label={t("HM-SET-10.copy")} kind="secondary" icon="copy" style={{ flexGrow: 1 }} onPress={() => void copy()} />
          <Btn label={t("HM-SET-10.share")} kind="secondary" icon="send" style={{ flexGrow: 1 }} onPress={() => void share()} />
        </View>
        {notice ? <Notice text={notice} tone={shared === "copied" ? "ok" : shared === "fileCopied" || shared === "longCopied" ? "info" : "bad"} /> : null}
      </View>

      <View style={{ marginTop: s.xl }}>
        <Btn label={t("HM-SET-10.again")} kind="text" icon="refresh-cw" onPress={onAgain} />
      </View>
    </Page>
  );
}
