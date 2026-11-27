import * as Calendar from "expo-calendar";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import { permissionRow, remindersRow, type OsReading, type PermissionId, type PermissionRow } from "@hermit/runtime";
import { requestCalendarPermission } from "./calendar";
import { contactsPermission, requestContactsPermission } from "./contacts";
import { notificationAccessEnabled, openNotificationAccessSettings } from "./messages";
import { requestReminderAccess } from "./notifier";
import { autofillSelected, openAutofillSettings } from "./autofill";
import { hardwarePlatform } from "../platform-facts";

/** HM-SET-01: reads each permission without prompting; the screen re-reads when the user comes back. */
const prompt = async (read: () => Promise<{ status: string; canAskAgain: boolean }>): Promise<OsReading> => {
  try {
    const r = await read();
    const status = r.status === "granted" || r.status === "denied" ? r.status : "undetermined";
    return { kind: "prompt", status, canAskAgain: r.canAskAgain };
  } catch {
    return { kind: "error" };
  }
};
const special = async (read: () => boolean | Promise<boolean>): Promise<OsReading> => {
  try {
    return { kind: "special", enabled: await read() };
  } catch {
    return { kind: "error" };
  }
};

export async function readPermissions(): Promise<PermissionRow[]> {
  const [notifications, calendar, contacts, notify, exact, fingerprint] = await Promise.all([
    special(() => notificationAccessEnabled()),
    prompt(() => Calendar.getCalendarPermissions()),
    prompt(() => contactsPermission()),
    prompt(() => Notifications.getPermissionsAsync()),
    special(async () => (await Notifications.getExactAlarmPermissionsAsync()).granted),
    special(() => LocalAuthentication.isEnrolledAsync()),
  ]);
  const os = hardwarePlatform(Platform.OS);
  return [
    permissionRow("notifications", notifications, os),
    permissionRow("calendar", calendar),
    permissionRow("contacts", contacts),
    remindersRow(notify, exact, os),
    permissionRow("fingerprint", fingerprint),
    // No voice in this build yet: listed so the user sees it, with nothing to grant.
    permissionRow("microphone", { kind: "not_used" }),
    // SL-35: Hermit as Android's autofill service; a phone or build without autofill says "not used".
    autofillRow(),
  ];
}

function autofillRow(): PermissionRow {
  try {
    const selected = autofillSelected();
    return permissionRow("autofill", selected === undefined ? { kind: "not_used" } : { kind: "special", enabled: selected });
  } catch {
    return permissionRow("autofill", { kind: "error" });
  }
}

const openSecuritySettings = async () => {
  try {
    await Linking.sendIntent("android.settings.SECURITY_SETTINGS");
  } catch {
    await Linking.openSettings();
  }
};

/** The row's button: the system prompt where Android still shows one, else the page that changes it. */
export async function actOnPermission(id: PermissionId, action: PermissionRow["action"]): Promise<void> {
  if (action === "none" || action === "retry") return;
  switch (id) {
    case "notifications":
      return openNotificationAccessSettings();
    case "fingerprint":
      return openSecuritySettings();
    case "calendar":
      if (action === "allow") return void (await requestCalendarPermission());
      return Linking.openSettings();
    case "contacts":
      if (action === "allow") return void (await requestContactsPermission());
      return Linking.openSettings();
    case "reminders":
      // Asks for notifications, then opens the exact-alarm page when that is what is missing.
      if (action === "allow" || action === "open_settings") {
        const notify = await Notifications.getPermissionsAsync().catch(() => undefined);
        if (action === "open_settings" && notify && !notify.granted && !notify.canAskAgain) return Linking.openSettings();
        return void (await requestReminderAccess());
      }
      return Linking.openSettings();
    case "autofill":
      return openAutofillSettings();
    case "microphone":
      return;
  }
}
