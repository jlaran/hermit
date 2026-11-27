import { describe, expect, test } from "vitest";
import { PROFILES } from "@hermit/model";
import { permissionRow, privacyHosts, remindersRow, showsRestrictedHelp } from "../src/settings-view.ts";

describe("permission rows (HM-SET-01, US-SET-01, US-ONB-08)", () => {
  test("a runtime permission maps to its state and the one action that changes it", () => {
    expect(permissionRow("calendar", { kind: "prompt", status: "granted", canAskAgain: true })).toEqual({ id: "calendar", state: "granted", action: "manage" });
    expect(permissionRow("calendar", { kind: "prompt", status: "undetermined", canAskAgain: true })).toEqual({ id: "calendar", state: "not_asked", action: "allow" });
    expect(permissionRow("calendar", { kind: "prompt", status: "denied", canAskAgain: true })).toEqual({ id: "calendar", state: "denied", action: "allow" });
    // Android stops showing the prompt after repeated denials: only the settings page can grant it now.
    expect(permissionRow("calendar", { kind: "prompt", status: "denied", canAskAgain: false })).toEqual({ id: "calendar", state: "denied", action: "open_settings" });
  });

  test("contacts (PDR-028) is a runtime permission like the calendar: Allow while Android still prompts, then the settings page", () => {
    expect(permissionRow("contacts", { kind: "prompt", status: "undetermined", canAskAgain: true })).toEqual({ id: "contacts", state: "not_asked", action: "allow" });
    expect(permissionRow("contacts", { kind: "prompt", status: "granted", canAskAgain: true })).toEqual({ id: "contacts", state: "granted", action: "manage" });
    expect(permissionRow("contacts", { kind: "prompt", status: "denied", canAskAgain: false })).toEqual({ id: "contacts", state: "denied", action: "open_settings" });
  });

  test("notification access has no prompt: off opens its settings page, with the restricted-settings help", () => {
    expect(permissionRow("notifications", { kind: "special", enabled: false })).toEqual({ id: "notifications", state: "denied", action: "open_settings", help: "restricted" });
    expect(permissionRow("notifications", { kind: "special", enabled: true })).toEqual({ id: "notifications", state: "granted", action: "manage" });
  });

  test("an iPhone has no restricted settings or exact alarms, so it never shows Android's steps for them (issue 128)", () => {
    expect(showsRestrictedHelp("android")).toBe(true);
    expect(showsRestrictedHelp("ios")).toBe(false);
    expect(permissionRow("notifications", { kind: "special", enabled: false }, "ios")).toEqual({ id: "notifications", state: "denied", action: "open_settings" });
    const on = { kind: "prompt", status: "granted", canAskAgain: true } as const;
    expect(remindersRow(on, { kind: "special", enabled: false }, "ios")).toEqual({ id: "reminders", state: "granted", action: "manage" });
    expect(remindersRow(on, { kind: "special", enabled: false }, "android")).toMatchObject({ state: "limited", help: "exact_alarm" });
  });

  test("a fingerprint that is not set up on the phone points to the phone's security settings", () => {
    expect(permissionRow("fingerprint", { kind: "special", enabled: false })).toEqual({ id: "fingerprint", state: "denied", action: "open_settings" });
  });

  test("autofill (SL-35) is Hermit being the selected service, with the browser and Samsung steps either way", () => {
    expect(permissionRow("autofill", { kind: "special", enabled: false })).toEqual({ id: "autofill", state: "denied", action: "open_settings", help: "autofill" });
    // Selected: Chrome still needs its own switch, so the help stays.
    expect(permissionRow("autofill", { kind: "special", enabled: true })).toEqual({ id: "autofill", state: "granted", action: "manage", help: "autofill" });
  });

  test("features this build does not have yet say so, with nothing to tap", () => {
    expect(permissionRow("microphone", { kind: "not_used" })).toEqual({ id: "microphone", state: "not_used", action: "none" });
    expect(permissionRow("autofill", { kind: "not_used" })).toEqual({ id: "autofill", state: "not_used", action: "none" });
  });

  test("a reading that failed is unknown with a retry, never shown as granted", () => {
    expect(permissionRow("calendar", { kind: "error" })).toEqual({ id: "calendar", state: "unknown", action: "retry" });
  });

  test("reminders need notifications and exact alarms; notifications alone is partial", () => {
    const granted = { kind: "prompt", status: "granted", canAskAgain: true } as const;
    expect(remindersRow(granted, { kind: "special", enabled: true })).toEqual({ id: "reminders", state: "granted", action: "manage" });
    expect(remindersRow(granted, { kind: "special", enabled: false })).toEqual({ id: "reminders", state: "limited", action: "open_settings", help: "exact_alarm" });
    expect(remindersRow({ kind: "prompt", status: "undetermined", canAskAgain: true }, { kind: "special", enabled: false })).toEqual({ id: "reminders", state: "not_asked", action: "allow" });
    expect(remindersRow(granted, { kind: "error" })).toEqual({ id: "reminders", state: "unknown", action: "retry" });
  });
});

describe("privacy hosts (HM-SET-02, US-SET-02, FR-PRIV-02)", () => {
  const modelHost = new URL(PROFILES[0]!.file.url).hostname;

  test("the hosts Hermit may contact are listed even before they are used, with zero", () => {
    expect(privacyHosts([])).toEqual([{ host: modelHost, purpose: "model_download", count: 0 }]);
  });

  test("counted hosts fill in counts; unknown ones follow, most used first", () => {
    const rows = privacyHosts([
      { host: "example.org", count: 1, lastAt: 5 },
      { host: modelHost, count: 3, lastAt: 9 },
      { host: "news.example", count: 4, lastAt: 7 },
    ]);
    expect(rows).toEqual([
      { host: modelHost, purpose: "model_download", count: 3, lastAt: 9 },
      { host: "news.example", purpose: "other", count: 4, lastAt: 7 },
      { host: "example.org", purpose: "other", count: 1, lastAt: 5 },
    ]);
  });

  test("SL-48: a connected email account's provider hosts are listed as the email provider, even before first use", () => {
    const rows = privacyHosts([{ host: "gmail.googleapis.com", count: 12, lastAt: 4 }], { mailHosts: ["gmail.googleapis.com", "oauth2.googleapis.com"] });
    expect(rows).toEqual([
      { host: modelHost, purpose: "model_download", count: 0 },
      { host: "gmail.googleapis.com", purpose: "mail", count: 12, lastAt: 4 },
      { host: "oauth2.googleapis.com", purpose: "mail", count: 0 },
    ]);
    // Without an account, a host it once used is just another host.
    expect(privacyHosts([{ host: "graph.microsoft.com", count: 2, lastAt: 1 }]).at(-1)).toMatchObject({ host: "graph.microsoft.com", purpose: "other" });
  });

  test("Dojo's relay is listed as the relay when it was used", () => {
    const rows = privacyHosts([{ host: "relay.dojocoding.io", count: 1, lastAt: 3 }], { relayHosts: ["relay.dojocoding.io"] });
    expect(rows.at(-1)).toEqual({ host: "relay.dojocoding.io", purpose: "relay", count: 1, lastAt: 3 });
  });
});
