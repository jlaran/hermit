import type { HostCount } from "@hermit/core";
import { PROFILES } from "@hermit/model";

/**
 * HM-SET-01 (US-SET-01, US-ONB-08): each permission's state and the one action that changes it.
 * The app reads the OS; these rules decide what the row says and which button it shows.
 */
export type PermissionId = "notifications" | "calendar" | "contacts" | "reminders" | "fingerprint" | "microphone" | "autofill";

/** What the OS reported for one permission. */
export type OsReading =
  /** A runtime permission with a system prompt (calendar, notifications). */
  | { kind: "prompt"; status: "granted" | "denied" | "undetermined"; canAskAgain: boolean }
  /** A switch that lives on a settings page with no prompt (notification access, exact alarms, an enrolled fingerprint). */
  | { kind: "special"; enabled: boolean }
  /** This build has no feature that uses it yet. */
  | { kind: "not_used" }
  /** Reading it failed. */
  | { kind: "error" };

export type PermissionState = "granted" | "not_asked" | "denied" | "limited" | "not_used" | "unknown";
/** allow: show the system prompt; open_settings: the page that grants it; manage: the page that changes or revokes it. */
export type PermissionAction = "allow" | "open_settings" | "manage" | "retry" | "none";

export interface PermissionRow {
  id: PermissionId;
  state: PermissionState;
  action: PermissionAction;
  /**
   * restricted: Android's restricted-settings steps (EC-ONB-05); exact_alarm: reminders may ring late; autofill: Chrome's
   * "Autofill using another service" switch and Samsung's autofill setting (SL-35, docs/research/autofill-spike.md).
   */
  help?: "restricted" | "exact_alarm" | "autofill";
}

/** Issue 128: restricted settings and exact alarms are Android's, so an iPhone never shows their steps. */
export function showsRestrictedHelp(platform: "android" | "ios"): boolean {
  return platform === "android";
}

export function permissionRow(id: PermissionId, r: OsReading, platform: "android" | "ios" = "android"): PermissionRow {
  switch (r.kind) {
    case "not_used":
      return { id, state: "not_used", action: "none" };
    case "error":
      return { id, state: "unknown", action: "retry" };
    case "special":
      // SL-35: whether Hermit is the selected autofill service. Chrome needs its own switch either way, so the help stays.
      if (id === "autofill") return r.enabled ? { id, state: "granted", action: "manage", help: "autofill" } : { id, state: "denied", action: "open_settings", help: "autofill" };
      if (r.enabled) return { id, state: "granted", action: "manage" };
      return { id, state: "denied", action: "open_settings", ...(id === "notifications" && showsRestrictedHelp(platform) ? { help: "restricted" as const } : {}) };
    case "prompt":
      if (r.status === "granted") return { id, state: "granted", action: "manage" };
      if (r.status === "undetermined") return { id, state: "not_asked", action: "allow" };
      // After repeated denials Android stops showing the prompt; only the settings page can grant it.
      return { id, state: "denied", action: r.canAskAgain ? "allow" : "open_settings" };
  }
}

/** Reminders need notifications and exact alarms (Android 14+ denies exact alarms by default; an iPhone has none). */
export function remindersRow(notifications: OsReading, exactAlarm: OsReading, platform: "android" | "ios" = "android"): PermissionRow {
  const n = permissionRow("reminders", notifications, platform);
  if (n.state !== "granted" || platform === "ios") return n;
  const exact = permissionRow("reminders", exactAlarm);
  if (exact.state === "granted" || exact.state === "unknown") return exact;
  return { id: "reminders", state: "limited", action: "open_settings", help: "exact_alarm" };
}

/**
 * HM-SET-02 (US-SET-02, FR-PRIV-02): where Hermit connects. The hosts it may contact are listed even
 * before first use (with zero), then every other host the counter saw, most used first.
 */
/** `relay`: Dojo's sign-in relay; `own_relay`: the user's own (SL-57); `mail`: a connected email account's provider (SL-48). */
export type HostPurpose = "model_download" | "relay" | "own_relay" | "search" | "mail" | "other";

export interface PrivacyHostRow {
  host: string;
  purpose: HostPurpose;
  count: number;
  lastAt?: number;
}

const hostOfUrl = (url: string) => /^https:\/\/([^/:?#]+)/i.exec(url)?.[1]?.toLowerCase();

/** The hosts this build may contact on its own: the pinned model files. */
export function knownHosts(): Array<{ host: string; purpose: HostPurpose }> {
  const hosts = new Set(PROFILES.map((p) => hostOfUrl(p.file.url)).filter((h): h is string => Boolean(h)));
  return [...hosts].map((host) => ({ host, purpose: "model_download" }));
}

/**
 * `searchHosts`: the search provider chosen on this screen (US-WEB-03), listed even before the first search.
 * `relayHosts` (Dojo's, once opted in) and `ownRelayHosts` (the user's own, once saved) on HM-CONN-05 (SL-57) are
 * listed the same way: a sign-in may contact them. `mailHosts` (SL-48): the providers of the connected email accounts.
 */
export function privacyHosts(counted: HostCount[], opts: { relayHosts?: string[]; ownRelayHosts?: string[]; searchHosts?: string[]; mailHosts?: string[] } = {}): PrivacyHostRow[] {
  const byHost = new Map(counted.map((c) => [c.host, c]));
  const listed = (hosts: string[] | undefined, purpose: HostPurpose) => (hosts ?? []).map((host) => ({ host, purpose }));
  const chosen = [...knownHosts(), ...listed(opts.searchHosts, "search"), ...listed(opts.mailHosts, "mail"), ...listed(opts.ownRelayHosts, "own_relay"), ...listed(opts.relayHosts, "relay")];
  const known = chosen
    .filter((k, i) => chosen.findIndex((x) => x.host === k.host) === i)
    .map(({ host, purpose }): PrivacyHostRow => {
      const c = byHost.get(host);
      return c ? { host, purpose, count: c.count, lastAt: c.lastAt } : { host, purpose, count: 0 };
    });
  const knownSet = new Set(known.map((k) => k.host));
  const others = counted
    .filter((c) => !knownSet.has(c.host))
    .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
    .map((c): PrivacyHostRow => ({ host: c.host, purpose: "other", count: c.count, lastAt: c.lastAt }));
  return [...known, ...others];
}
