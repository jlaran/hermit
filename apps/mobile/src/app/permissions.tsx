// HM-ONB-04: notification, calendar and contacts access, each optional (US-ONB-04, US-ONB-05, US-ONB-08, PDR-028).
// Design pass (O2): step 3 of 3, one optional list with a reason and Allow per row, and a "Not now" that holds.
import { openHermitChat } from "../open-chat";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";
import { showsRestrictedHelp } from "@hermit/runtime";
import { NotWiredError, requestCalendarAccess, requestContactsPermission, requestNotificationAccess, requestReminderPermission, setUpApprovals } from "../adapters";
import type { IconName } from "../components/Icon";
import { Btn, Group, Row, Status, T } from "../components/kit";
import { Onb } from "../components/Onboarding";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { hardwarePlatform } from "../platform-facts";
import { s } from "../theme";

type Grant = "unknown" | "granted" | "denied" | "not_wired";

export default function Permissions() {
  const { status } = useHermit();
  const [notif, setNotif] = useState<Grant>("unknown");
  const [cal, setCal] = useState<Grant>("unknown");
  const [contacts, setContacts] = useState<Grant>("unknown");
  const [fingerprint, setFingerprint] = useState<Grant>("unknown");
  const [reminders, setReminders] = useState<Grant>("unknown");

  const ask = async (fn: () => Promise<boolean>, set: (g: Grant) => void) => {
    try {
      set((await fn()) ? "granted" : "denied");
    } catch (err) {
      set(err instanceof NotWiredError ? "not_wired" : "denied");
    }
  };
  const finish = async () => {
    if (status.kind === "ready") await status.hermit.settings.set("onboarding.done", "1");
    openHermitChat(router, "onboarding");
  };

  const row = (icon: IconName, title: string, body: string, grant: Grant, onAllow: () => void, help?: string) => (
    <Row
      icon={icon}
      title={title}
      top
      sub={
        <View style={{ gap: s.sm }}>
          <T v="small" color="soft">{body}</T>
          {help && grant === "denied" ? <T v="small" color="soft">{help}</T> : null}
          {grant === "granted" ? (
            <Status text={t("HM-ONB-04.granted")} tone="link" icon="check" />
          ) : grant === "not_wired" ? (
            <T v="caption" color="soft">Dev build: not wired yet</T>
          ) : (
            <Btn label={grant === "denied" ? t("HM-ONB-04.openSettings") : t("HM-ONB-04.allow")} kind="secondary" small onPress={onAllow} />
          )}
        </View>
      }
    />
  );

  return (
    <Onb
      pose="idle"
      step={3}
      title={t("HM-ONB-04.title")}
      body={t("HM-ONB-04.intro")}
      footer={
        <>
          <Btn label={t("HM-ONB-04.done")} full onPress={() => void finish()} />
          <Btn label={t("common.notNow")} kind="text" full onPress={() => void finish()} />
        </>
      }
    >
      <Group>
        {row("bell", t("HM-ONB-04.notificationsTitle"), t("HM-ONB-04.notificationsBody"), notif, () => ask(requestNotificationAccess, setNotif), showsRestrictedHelp(hardwarePlatform(Platform.OS)) ? t("HM-ONB-04.restrictedHelp") : undefined)}
        {row("calendar", t("HM-ONB-04.calendarTitle"), t("HM-ONB-04.calendarBody"), cal, () => ask(requestCalendarAccess, setCal))}
        {row("contact", t("HM-ONB-04.contactsTitle"), t("HM-ONB-04.contactsBody"), contacts, () => ask(requestContactsPermission, setContacts))}
        {row("bell-ring", t("HM-ONB-04.remindersTitle"), t("HM-ONB-04.remindersBody"), reminders, () => ask(requestReminderPermission, setReminders))}
        {row("fingerprint", t("HM-ONB-04.fingerprintTitle"), t("HM-ONB-04.fingerprintBody"), fingerprint, () => ask(() => setUpApprovals(t("HM-ONB-04.fingerprintTitle")), setFingerprint))}
      </Group>
    </Onb>
  );
}
