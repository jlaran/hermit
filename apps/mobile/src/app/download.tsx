// HM-ONB-03: download the model once, verify it, and recover from every failure (US-ONB-03, US-ONB-07, FR-MODEL-02).
// The rules live in @hermit/model (reduceDownload, downloadView); this screen only wires the phone to them.
// SL-43: before any byte moves, the floor check (US-ONB-06) sends a phone below the floor to HM-ONB-05. Design pass (O1):
// step 2 of 3, the percentage in large figures, and how the file comes and is checked (Wi-Fi, pinned SHA-256).
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { PROFILES, assertPinnedUrl, classifyInterruption, downloadView, floorCheck, percent, reduceDownload, resumesOnReturn, type DegradedReason, type DownloadAction, type DownloadEvent, type DownloadState } from "@hermit/model";
import { deviceFacts, downloadModel, floorFacts, modelReady, NotWiredError, onReconnect, openStorageSettings, partialModel, pauseDownloadWhenLeaving } from "../adapters";
import { currentLocale, t } from "../i18n";
import { Btn, Group, Row, T } from "../components/kit";
import { Onb } from "../components/Onboarding";
import type { Pose } from "../mascot";
import { s } from "../theme";
import { usePalette } from "../use-palette";

const file = PROFILES[0]!.file;
const mb = (bytes: number) => `${new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 }).format(bytes / 1_000_000)} MB`;
const reduce = (s: DownloadState, e: DownloadEvent) => reduceDownload(file, s, e);

/**
 * SL-43: true when the download may go ahead. Below the floor it opens HM-ONB-05 instead, unless the user chose
 * "Download anyway" there (PDR-025). Unreadable facts never block (floorCheck needs evidence).
 */
async function passesFloor(anyway: boolean, onDegraded: (r: DegradedReason[]) => void): Promise<boolean> {
  const verdict = await floorFacts().then(floorCheck, () => ({ kind: "supported" as const }));
  if (verdict.kind === "degraded") onDegraded(verdict.reasons);
  if (verdict.kind === "below_floor" && !anyway) {
    router.replace("/unsupported");
    return false;
  }
  return true;
}

export default function Download() {
  const p = usePalette();
  const [allowMobile, setAllowMobile] = useState(false);
  const [notWired, setNotWired] = useState<string[]>();
  const anyway = useLocalSearchParams<{ anyway?: string }>().anyway === "1";
  const [slow, setSlow] = useState<DegradedReason[]>();
  const [state, dispatch] = useReducer(reduce, { kind: "idle" } as DownloadState);
  const current = useRef(state);
  current.current = state;
  const busy = useRef(false);

  // On open: a verified model skips to ready; an unverified partial file from an earlier run offers to resume (EC-ONB-04).
  useEffect(() => {
    if (modelReady(file)) {
      for (const e of [
        { type: "start", device: { network: "wifi", freeBytes: Number.MAX_SAFE_INTEGER, allowMobileData: true }, partialBytes: 0 },
        { type: "downloaded" },
        { type: "verified", sha256: file.sha256 },
      ] as DownloadEvent[]) dispatch(e);
    } else {
      dispatch({ type: "found_partial", partialBytes: partialModel(file) });
      void passesFloor(anyway, setSlow);
    }
  }, [anyway]);

  const run = useCallback(async (allowMobileData: boolean) => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!(await passesFloor(anyway, setSlow))) return;
      assertPinnedUrl(file);
      const start: DownloadEvent = { type: "start", device: { ...(await deviceFacts()), allowMobileData }, partialBytes: partialModel(file) };
      const next = reduce(current.current, start);
      dispatch(start);
      if (next.kind !== "downloading") return;
      let dl: Awaited<ReturnType<typeof downloadModel>>;
      try {
        dl = await downloadModel(file.url, next.from, (received) => dispatch({ type: "progress", received }));
      } catch (err) {
        if (err instanceof NotWiredError) return setNotWired(err.slices);
        // The partial file stays on disk; say why it stopped so the next attempt resumes from it.
        const facts = await deviceFacts().catch(() => ({ freeBytes: Number.MAX_SAFE_INTEGER }));
        const message = err instanceof Error ? err.message : undefined;
        dispatch({ type: classifyInterruption(file, { message, freeBytes: facts.freeBytes, received: partialModel(file) }) });
        return;
      }
      dispatch({ type: "downloaded" });
      // Only a matching file is promoted to the path the engine loads; anything else, or a failed read, is deleted.
      const sha = await dl.sha256().then((h) => h.toLowerCase(), () => "");
      if (sha === file.sha256) await dl.promote(sha);
      else await dl.discard();
      dispatch({ type: "verified", sha256: sha });
    } finally {
      busy.current = false;
    }
  }, [anyway]);

  // EC-ONB-03 and the network-lost state: re-check and resume when the user comes back from Settings or the phone reconnects.
  useEffect(() => {
    const resume = () => {
      if (resumesOnReturn(current.current)) void run(allowMobile);
    };
    const app = AppState.addEventListener("change", (s) => s === "active" && resume());
    const off = onReconnect(resume);
    return () => {
      app.remove();
      off();
    };
  }, [run, allowMobile]);

  // iOS (#127): leaving the app or losing the connection pauses the download so it keeps its place; the pause lands
  // as an interrupted download above, and coming back or reconnecting resumes it. Nothing on Android.
  useEffect(() => pauseDownloadWhenLeaving(), []);

  const onAction = (id: DownloadAction) => {
    switch (id) {
      case "start":
      case "resume":
      case "retry_clean":
        return void run(allowMobile);
      case "allow_mobile":
        setAllowMobile(true);
        return void run(true);
      case "storage_settings":
        return void openStorageSettings();
      case "continue":
        return router.push("/permissions");
    }
  };

  const view = downloadView(file, state);
  const vars = Object.fromEntries(Object.entries(view.vars).map(([k, v]) => [k, k === "size" ? mb(v) : v]));
  const showBar = state.kind === "downloading" || state.kind === "interrupted" || state.kind === "resumable" || (state.kind === "low_storage" && state.received > 0);

  // O1: the working crab while bytes move, the done crab once verified, the resting one otherwise.
  const pose: Pose = state.kind === "downloading" ? "working" : state.kind === "ready" ? "done" : "idle";
  const pct = percent(state);
  return (
    <Onb
      pose={pose}
      step={2}
      title={t("HM-ONB-03.title")}
      footer={
        <>
          {notWired ? <T v="caption" color="soft">Dev build: {notWired.join(", ")}</T> : null}
          {view.actions.map((a, i) => {
            const primary = i === view.actions.length - 1;
            return <Btn key={a.id} label={t(a.label)} kind={primary ? "primary" : "text"} full onPress={() => onAction(a.id)} />;
          })}
          {view.actions.length === 0 ? <T v="small" color="soft" center>{t("HM-ONB-03.footer")}</T> : null}
        </>
      }
    >
      <T v="body" color="soft" live="polite">{t(view.body, vars)}</T>
      {/* US-ONB-06: phones QVAC keeps on the CPU, or that measured slow, may continue; they're told replies will be slow. */}
      {slow && state.kind !== "ready" ? <T v="body" color="soft">{t(slow.includes("cpu_only") ? "HM-ONB-03.slowPhoneCpu" : "HM-ONB-03.slowPhone")}</T> : null}
      {showBar ? (
        <View style={{ gap: s.sm }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
          <T v="figure">{`${pct}%`}</T>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: p.track, overflow: "hidden" }}>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: state.kind === "downloading" ? p.meter : p.soft, width: `${pct}%` }} />
          </View>
        </View>
      ) : null}
      <Group style={{ marginTop: s.md }}>
        <Row icon="wifi" title={t("HM-ONB-03.onWifi")} sub={t("HM-ONB-03.onWifiSub")} top />
        <Row icon="shield-check" title={t("HM-ONB-03.checked")} sub={t("HM-ONB-03.checkedSub")} top />
        <Row icon="plane" title={t("HM-ONB-03.afterThis")} sub={t("HM-ONB-01.promiseOffline")} top />
      </Group>
    </Onb>
  );
}
