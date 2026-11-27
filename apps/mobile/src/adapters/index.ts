import { SECRET_KEYS, type ApprovalRequest, type SqlPort } from "@hermit/core";
import type { HermitPorts } from "@hermit/runtime";
import { getRandomBytes, randomUUID } from "expo-crypto";
import Constants from "expo-constants";
import { AppState } from "react-native";
import { cpuListText, PROFILES, type CompletionEngine, type RuntimePlan } from "@hermit/model";
import { currentLocale, translate } from "../i18n";
import { authenticateApproval, provisionApprovalKey, verifyApproval } from "./approver";
import { phoneCalendar } from "./calendar";
import { encryptedSql } from "./op-sqlite";
import { qvacEngine } from "./qvac-engine";
import type { CacheOwners } from "../cache-keys";
import { reminderNotifier, requestReminderAccess } from "./notifier";
import { plainSecret } from "./secure";
import { deviceSigner } from "./signer";
import { calendarPermissionGranted, requestCalendarPermission } from "./calendar";
import { allowedCpus, loadPlan, modelFile, partialBytes, phoneDownload, phoneFacts, reloadPlan, runtimeConditions, verifiedSha256 } from "./device";
import { notificationAccessEnabled, openNotificationAccessSettings, startCapture, whatsappReply } from "./messages";
import { intentCopy, phoneIntents } from "./intents";
import { phoneContacts } from "./contacts";
import { webFetch } from "./web";
import { trackPrompt } from "./app-lock";
import { countOutbound } from "./net";
import { vaultPorts, vaultRandom } from "./vault";
import { payWorkletPort, walletPorts } from "./wallet";
import { mcpTransport } from "./mcp";
import { relayTransport } from "./relay";
import { DOJO_CLIENT_IDS, DOJO_RELAY_URL } from "../dojo-config";
import { phoneCredentials } from "./credentials";
import { approvalKeyPort, signApproval, signMessage } from "./approval-key";
import { autofillPort } from "./autofill";
import { activeFile, activeModel, checkModelUpdate, inTurn, recoverModelUpdate, setModelUpdateHooks, swapInProgress, turnStarted } from "./model-update";
import { confirmWithFingerprint } from "./fingerprint";
import { browserPorts } from "./browser";
import { startMail } from "./mail";
import { engineSlot } from "../engine-slot";

export { startCapture, notificationAccessEnabled, openNotificationAccessSettings };
export { appLockEnabled, confirmOwner, onPrompt, phoneSecurity, saveAppLock } from "./app-lock";
export { forgetBotCaches } from "./qvac-engine";
export { countedFetch, setOutboundSink } from "./net";
export { actOnPermission, readPermissions } from "./permissions";
export { requestContactsPermission } from "./contacts";
export { clearPendingCopy, copySensitive, deleteCsvFile, pickCsvFile, readCsvFile, secureScreen, type PickedDocument } from "./vault";
export { autofillSelected, cancelFill, completeFill, openAutofillSettings, pendingFill } from "./autofill";

/**
 * The phone side of every port. Each one is built by its W1 slice; until then it reports
 * which slice owns it, and the app shows that in the dev build instead of pretending to work.
 */
export class NotWiredError extends Error {
  constructor(readonly slices: string[]) {
    super(`Not wired yet in this build: ${slices.join(", ")}`);
    this.name = "NotWiredError";
  }
}

/** Slices whose adapters are still missing, in the order they unblock the first win. */
export const MISSING: Array<{ port: keyof HermitPorts; slice: string }> = [];

// Built: signer (./signer), approvals key (./approver), notifier (./notifier), calendar (./calendar),
// device facts and download (./device), WhatsApp capture and reply (./messages, proven by spike S4).
// createPorts assembles them once SL-09 and SL-10 land.

/** Every port from its phone adapter. The model loads lazily, after onboarding downloaded and verified it. */
export { devicePlan, floorFacts, nightConditions } from "./device";
export { checkModelUpdate, modelUpdateState, onModelUpdate } from "./model-update";
export { backgroundStatus, liveHermit, nightErasing, openBatterySettings, startNightScheduler, syncNightSchedule, wakeNightShift } from "./night";

// EC-CHAT-01: the first turn after launch waits for the model to load; the chat says so.
const modelLoading = new Set<(loading: boolean) => void>();
export function onModelLoading(listener: (loading: boolean) => void): () => void {
  modelLoading.add(listener);
  return () => void modelLoading.delete(listener);
}

/** The runtime's bots and their oldest chats, for each load's sweep of the prompt caches (../cache-keys). */
let cacheOwners: (() => Promise<CacheOwners>) | undefined;
/** Set once Hermit is up (hermit-context); a load before that sweeps nothing. */
export function setCacheOwners(owners: () => Promise<CacheOwners>): void {
  cacheOwners = owners;
}

/**
 * The loaded model, kept here so the erase (SL-26) can unload it before deleting its files and caches. It loads with
 * the threads for the cores Android allows the app at that moment, and loads again at a safe point when those change
 * (../engine-slot.ts; on the S26: 5 threads on screen, 3 in the background).
 */
const model = engineSlot<CompletionEngine & { close(): Promise<void> }, RuntimePlan | undefined>({
  plan: loadPlan,
  recheck: (loaded) => (loaded ? reloadPlan(loaded) : undefined),
  load: (plan) => {
    const profile = PROFILES[0]!;
    // The model an update made active (SL-43), else the pinned one; with no update both are the same file.
    const file = activeFile() ?? modelFile(profile.file.url.split("/").pop()!);
    return qvacEngine(file.uri, profile, plan ? { plan, conditions: runtimeConditions } : undefined, { owners: async () => cacheOwners?.() });
  },
  onLoading: (loading) => {
    for (const l of modelLoading) l(loading);
  },
});
let liveSql: SqlPort | undefined;

/** SL-26: unloads the model if it was loaded (or is loading). */
export function releaseModel(): Promise<void> {
  return model.close();
}

// Dev builds: where the app's cores stand a moment after it comes or goes (Android moves its cpuset right after the
// switch). Nothing reloads here: the next turn's first completion is the safe point, and it reads the cores again.
let watchingCores = false;
function logCoresOnAppState(): void {
  if (!__DEV__ || watchingCores) return;
  watchingCores = true;
  AppState.addEventListener("change", (state) => {
    setTimeout(() => {
      const now = allowedCpus();
      console.log(`[hermit:threads] app ${state}: cpuset ${now?.cpuset ?? "unknown"}, allowed ${cpuListText(now?.cpus)}, model threads ${model.loaded()?.threads ?? "not loaded"}`);
    }, 1000);
  });
}

/** SL-26: the database this run opened, if any. */
export function openDatabase(): SqlPort | undefined {
  return liveSql;
}

export async function createPorts(approvals: HermitPorts["approvals"]): Promise<HermitPorts> {
  const profile = PROFILES[0]!;
  const dbKey = Array.from(await plainSecret(SECRET_KEYS.db), (b) => b.toString(16).padStart(2, "0")).join("");
  liveSql = encryptedSql(dbKey);
  const wallet = walletPorts();
  logCoresOnAppState();
  const lazyEngine: CompletionEngine = {
    complete: async (req) => {
      // A completion that starts a turn (none running, none in the last seconds) is the only point where the model
      // may load again with other threads: never between the steps of a turn.
      const safePoint = !inTurn();
      // SL-43: a model update never swaps during a turn, and a turn waits while one swaps.
      const done = turnStarted();
      try {
        await swapInProgress();
        if (!modelReady(profile.file)) throw new Error("The model isn't downloaded and verified yet.");
        // The plan from this phone's own hardware and the cores it may use now (rules; calibration refines it when it lands).
        const { engine, release } = await model.use(safePoint);
        try {
          return await engine.complete(req);
        } finally {
          release();
        }
      } finally {
        done();
      }
    },
  };
  // SL-43: the update's self-test loads the new file on its own and answers one short prompt.
  setModelUpdateHooks({
    release: releaseModel,
    smoke: async (uri, prompt) => {
      const plan = await loadPlan();
      const e = await qvacEngine(uri, profile, plan ? { plan, conditions: runtimeConditions } : undefined);
      try {
        const r = await e.complete({ messages: [{ role: "user", content: prompt }], thinking: { enabled: false }, sampling: profile.sampling, maxTokens: 16 });
        return r.text;
      } finally {
        await e.close();
      }
    },
  });
  // Finishes or rolls back an update a kill interrupted, then looks for one. Both do nothing in this build (no journal, no source).
  void recoverModelUpdate().then(() => checkModelUpdate(false)).catch(() => {});
  // SL-48 and SL-49: email over the providers' own APIs, tokens in the Keystore store, accounts in the encrypted database.
  const mail = startMail(liveSql);
  // SL-56b (Q141): a web task's one-time code from the SMS consent dialog, and from the site's email in a Gmail account.
  const browser = browserPorts([mail.codeSource]);
  return {
    sql: liveSql,
    signer: await deviceSigner(),
    notifier: await reminderNotifier(),
    calendar: phoneCalendar(),
    replySender: whatsappReply,
    intents: { launcher: phoneIntents, copy: intentCopy },
    // PDR-028: names the user says are looked up in the contacts by code, and for email in the people the user sent
    // mail to (the address book's "sent" origin only).
    people: { contacts: phoneContacts, pastRecipients: () => mail.pastRecipients(), copy: intentCopy },
    // SL-48 and SL-49: the mail skills through the cage; the send, draft and organize sheets' trusted data; the night
    // shift's email job (Q67: unread only, the switch is the permission; Q68: reply drafts for people the user writes to).
    mail: mail.skills,
    mailRender: () => mail.render(),
    mailNight: mail.night,
    engine: lazyEngine,
    approvals,
    // SL-22 and SL-23: read_web and search_web over HTTPS (./web, every request counted), answers in the language the user spoke.
    web: { fetch: webFetch, copy: translate },
    // SL-33: HM-VAULT-01 and HM-VAULT-02. No skill uses it, so the model never sees the vault (FR-VAULT-02).
    vault: vaultPorts,
    // SL-38: HM-PAY-01 and HM-PAY-02, when this build has the wallet bundle. No skill uses it and the night shift never
    // gets it, so the model never sees the wallet (FR-PAY-01).
    ...(wallet ? { wallet } : {}),
    // SL-40: paying a person by asking, within caps, only with the wallet bundle (and the approval key, below). The
    // worklet's payment methods; HM-PAY-05's strong-biometric check before a cap or payee changes (no PIN fallback, the
    // approvals' bar); the chat's answers and the sheet's lines in the language the user spoke.
    ...(wallet
      ? {
          pay: {
            worklet: payWorkletPort,
            confirm: async (prompt: string) => (await trackPrompt(() => confirmWithFingerprint(prompt, translate(currentLocale(), "HM-PAY-05.cancel")))) === "confirmed",
            copy: (lang: "es-419" | "en", key: string, vars?: Record<string, string>) => translate(lang, key, vars),
          },
        }
      : {}),
    // SL-54: MCP servers the user adds on HM-CONN-03; tokens only in the Keystore-backed credential store.
    mcp: { transport: mcpTransport, credentials: phoneCredentials, random: (n) => getRandomBytes(n), clientVersion: Constants.expoConfig?.version ?? "0.0.0", copy: (lang, key) => translate(lang, key) },
    // SL-55: HM-CONN-04. The same counted, checked HTTPS adapter and Keystore credential store; an install needs a
    // strong-biometric fingerprint (no PIN fallback), the same bar as approvals.
    connect: {
      transport: mcpTransport,
      credentials: phoneCredentials,
      random: (n) => getRandomBytes(n),
      confirm: async () => (await trackPrompt(() => confirmWithFingerprint(translate(currentLocale(), "HM-CONN-04.installPrompt"), translate(currentLocale(), "HM-CONN-04.cancel")))) === "confirmed",
      copy: (lang, key, vars) => translate(lang, key, vars),
    },
    // Multi-bot (HM-BOT-03, HM-BOT-04): granting mail send, logins or pay, and turning on Don't ask, take the same
    // strong-biometric fingerprint (no PIN fallback); the runtime writes the prompt in the app's language.
    bots: {
      confirm: async (prompt: string) => (await trackPrompt(() => confirmWithFingerprint(prompt, translate(currentLocale(), "common.cancel")))) === "confirmed",
    },
    // SL-57: HM-CONN-05's relays over the counted HTTPS adapter; Dojo's relay URL and client IDs (Q43) come from
    // ../dojo-config, unset until Dojo's apps exist.
    relay: { transport: relayTransport, ...(DOJO_RELAY_URL ? { dojoRelayUrl: DOJO_RELAY_URL } : {}), dojoClientIds: DOJO_CLIENT_IDS },
    // SL-37: the Keystore key that signs money and password approvals, and the secure random for nonces.
    approvalKey: { port: approvalKeyPort, randomBytes: vaultRandom },
    // SL-35 and SL-36: the autofill service gets the profile's kinds and the logins' id hashes, names and origins,
    // never a value (HM-FORM-01 and HM-APPR-01 ask for each fill).
    autofill: autofillPort,
    // SL-53: HM-WEB-02, the in-app browser for web tasks (absent on an APK without the module).
    ...(browser ? { browser } : {}),
    verifyApproval,
    now: () => Date.now(),
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: () => currentLocale(),
    newId: () => randomUUID(),
    // W1: the chat's answers after actions and reads, and "what can you do?", in code's words from copy.
    copy: (lang: "es-419" | "en", key: string, vars?: Record<string, string>) => translate(lang, key, vars),
    // W1 review: what Android lets Hermit use right now, read without prompting, so "what can you do?" is honest.
    access: async () => {
      let notifications = false;
      try {
        notifications = notificationAccessEnabled();
      } catch {
        // No capture module in this build: WhatsApp can't be read.
      }
      return { notifications, calendar: await calendarPermissionGranted().catch(() => false) };
    },
  };
}

/** The fingerprint prompt (US-APPR-02): unlocks the approval key and signs this exact request. */
export function authenticate(req: ApprovalRequest, prompt: string): Promise<{ biometric: boolean; proof?: string; signature?: string }> {
  // SL-37: money and passwords are signed by the Keystore key inside the system prompt; the JS key never signs them.
  if (req.signed) return trackPrompt(() => signApproval(req, currentLocale()));
  return trackPrompt(() => authenticateApproval(req, prompt));
}

export { ApprovalSignError } from "./approval-key";

/** SL-36: the approval key signs a login's exact payload inside its own fingerprint prompt (HM-APPR-01). */
export function signLogin(message: string): Promise<string> {
  return trackPrompt(() => signMessage(message, currentLocale()));
}

/** Network type and free space for the download rules (US-ONB-03). Built in SL-01. */
export function deviceFacts(): Promise<{ network: "wifi" | "cellular" | "none"; freeBytes: number }> {
  return phoneFacts();
}

/**
 * Resumable HTTPS download that reports bytes, then streams the file back for hashing. Built in SL-01;
 * `from` (SL-16) is the state machine's `downloading.from`: 0 starts clean, more resumes from that byte.
 */
export function downloadModel(url: string, from: number, onProgress: (received: number) => void): Promise<{ chunks(): AsyncIterable<Uint8Array>; sha256(): Promise<string>; discard(): Promise<void>; promote(sha256: string): Promise<void> }> {
  const expected = PROFILES.find((p) => p.file.url === url)?.file.size;
  countOutbound(url); // FR-PRIV-02: the model host, for the privacy screen
  return phoneDownload(url, url.split("/").pop() ?? "model.gguf", from, onProgress, expected);
}

/** Bytes of an unverified partial download on disk, for resuming after a kill or a drop (EC-ONB-04). */
export function partialModel(file: { url: string }): number {
  return partialBytes(file.url.split("/").pop() ?? "model.gguf", file.url);
}

export { onReconnect, openStorageSettings, pauseDownloadWhenLeaving } from "./device";

/** True only when the model in place was promoted with exactly the SHA-256 this build pins, or an update made one active. */
export function modelReady(file: { url: string; sha256: string }): boolean {
  // SL-43: or the verified model an update made active (no pointer exists without an update).
  return verifiedSha256(file.url.split("/").pop() ?? "model.gguf") === file.sha256 || activeModel() !== undefined;
}

/**
 * Notification access (US-ONB-04): Android has no prompt for it, so this opens the settings page
 * and reports the current state; the screen re-checks when the user comes back.
 */
export async function requestNotificationAccess(): Promise<boolean> {
  if (notificationAccessEnabled()) return true;
  openNotificationAccessSettings();
  return notificationAccessEnabled();
}
export function requestCalendarAccess(): Promise<boolean> {
  return requestCalendarPermission();
}

/** HM-CAL-02: calendar access right now, without a prompt (ST-FORBIDDEN when off). */
export function calendarAccessGranted(): Promise<boolean> {
  return calendarPermissionGranted();
}

/** ST-FORBIDDEN's one button: this app's page in the system settings, where calendar access is turned on. */
export { openAppSettings } from "./calendar";

/** US-APPR-02 setup: the approval key is created here, behind an explicit fingerprint, never during an approval. */
export function setUpApprovals(prompt: string): Promise<boolean> {
  return trackPrompt(() => provisionApprovalKey(prompt));
}

/** Notifications plus exact alarms, so reminders fire on time (Android 14+ denies exact alarms by default). */
export function requestReminderPermission(): Promise<boolean> {
  return requestReminderAccess();
}
