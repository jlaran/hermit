import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { applyBiometricName } from "../adapters/fingerprint";
import { AppLockProvider } from "../app-lock";
import { useDisplaySync } from "../display-settings";
import { HermitProvider } from "../hermit-context";
import { t } from "../i18n";
import { usePalette } from "../use-palette";

// Issue 128: Face ID or Touch ID in the copy on an iPhone, read once before the first screens need it.
void applyBiometricName();

// HM-ONB-02, HM-SET-05, HM-SET-07: the stored language and scheme, applied once the runtime is ready.
function DisplaySync() {
  useDisplaySync();
  return null;
}

export default function RootLayout() {
  const p = usePalette();
  return (
    <HermitProvider>
      <DisplaySync />
      <AppLockProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: p.background },
            headerTintColor: p.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: p.background },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          {/* HM-BOT-02, HM-BOT-03, HM-BOT-04: one bot's chat, a new bot, a bot's settings. */}
          <Stack.Screen name="chat" options={{ headerShown: false }} />
          <Stack.Screen name="bot-new" options={{ headerShown: false }} />
          <Stack.Screen name="bot-settings" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="language" options={{ headerShown: false }} />
          <Stack.Screen name="download" options={{ headerShown: false }} />
          <Stack.Screen name="unsupported" options={{ headerShown: false }} />
          <Stack.Screen name="permissions" options={{ headerShown: false }} />
          <Stack.Screen name="where" options={{ title: t("HM-CHAT-02.title"), headerShown: false }} />
          <Stack.Screen name="activity" options={{ title: t("HM-ACT-01.title"), headerShown: false }} />
          <Stack.Screen name="activity-entry" options={{ title: t("HM-ACT-02.title"), headerShown: false }} />
          <Stack.Screen name="messages" options={{ title: t("HM-MSG-01.title"), headerShown: false }} />
          <Stack.Screen name="reminders" options={{ title: t("HM-REM-01.title"), headerShown: false }} />
          <Stack.Screen name="calendar" options={{ title: t("HM-CAL-02.title"), headerShown: false }} />
          <Stack.Screen name="memories" options={{ title: t("HM-MEM-01.title"), headerShown: false }} />
          <Stack.Screen name="memory" options={{ title: t("HM-MEM-02.title"), headerShown: false }} />
          <Stack.Screen name="web" options={{ title: t("HM-WEB-01.title"), headerShown: false }} />
          <Stack.Screen name="settings" options={{ title: t("HM-SET-01.title"), headerShown: false }} />
          <Stack.Screen name="use" options={{ title: t("HM-SET-09.title"), headerShown: false }} />
          <Stack.Screen name="privacy" options={{ title: t("HM-SET-02.title"), headerShown: false }} />
          <Stack.Screen name="appearance" options={{ title: t("HM-SET-06.title"), headerShown: false }} />
          <Stack.Screen name="about" options={{ title: t("HM-SET-08.title"), headerShown: false }} />
          <Stack.Screen name="device-lab" options={{ title: t("HM-SET-10.title"), headerShown: false }} />
          <Stack.Screen name="delete" options={{ title: t("HM-SET-03.title"), headerShown: false }} />
          <Stack.Screen name="night" options={{ title: t("HM-NIGHT-01.title"), headerShown: false }} />
          <Stack.Screen name="briefing" options={{ title: t("HM-NIGHT-02.title"), headerShown: false }} />
          <Stack.Screen name="vault" options={{ title: t("HM-VAULT-01.title"), headerShown: false }} />
          <Stack.Screen name="vault-item" options={{ title: t("HM-VAULT-02.title"), headerShown: false }} />
          <Stack.Screen name="wallet" options={{ title: t("HM-PAY-01.title"), headerShown: false }} />
          <Stack.Screen name="wallet-words" options={{ title: t("HM-PAY-02.title"), headerShown: false }} />
          <Stack.Screen name="wallet-history" options={{ title: t("HM-PAY-03.title"), headerShown: false }} />
          <Stack.Screen name="wallet-receive" options={{ title: t("HM-PAY-04.title"), headerShown: false }} />
          <Stack.Screen name="wallet-caps" options={{ title: t("HM-PAY-05.title"), headerShown: false }} />
          <Stack.Screen name="mcp" options={{ title: t("HM-CONN-03.title"), headerShown: false }} />
          <Stack.Screen name="sign-in-options" options={{ title: t("HM-CONN-05.title"), headerShown: false }} />
          <Stack.Screen name="oauth/mcp" options={{ title: t("HM-CONN-03.title"), headerShown: false }} />
          {/* SL-48 and SL-49: email accounts, the messages a summary used, search results, one message, the draft, and
              where a Google or Microsoft sign-in comes back (Q156, Q157). */}
          <Stack.Screen name="mail" options={{ title: t("HM-MAIL-01.title"), headerShown: false }} />
          <Stack.Screen name="mail-summary" options={{ title: t("HM-MAIL-02.title"), headerShown: false }} />
          <Stack.Screen name="mail-search" options={{ title: t("HM-MAIL-03.title"), headerShown: false }} />
          <Stack.Screen name="mail-message" options={{ title: t("HM-MAIL-03.messageTitle"), headerShown: false }} />
          <Stack.Screen name="mail-draft" options={{ title: t("HM-MAIL-04.title"), headerShown: false }} />
          <Stack.Screen name="oauth2redirect" options={{ title: t("HM-MAIL-01.title"), headerShown: false }} />
          <Stack.Screen name="oauth/microsoft" options={{ title: t("HM-MAIL-01.title"), headerShown: false }} />
          <Stack.Screen name="connect" options={{ title: t("HM-CONN-04.title"), headerShown: false }} />
          <Stack.Screen name="browser" options={{ title: t("HM-WEB-02.title"), headerShown: false }} />
          <Stack.Screen name="vault-import" options={{ title: t("HM-VAULT-03.title"), headerShown: false }} />
          <Stack.Screen name="approval-key" options={{ title: t("HM-APPR-01.key.title"), headerShown: false }} />
          <Stack.Screen name="profile" options={{ title: t("HM-FORM-02.title"), headerShown: false }} />
          <Stack.Screen name="fill" options={{ title: t("HM-FORM-01.title"), headerShown: false }} />
          {/* Dev-only screens (debug builds): a title, never the route name. */}
          <Stack.Screen name="autofill-debug" options={{ title: t("HM-DEV-01.title"), headerShown: false }} />
          <Stack.Screen name="wallet-debug" options={{ title: t("HM-DEV-02.title"), headerShown: false }} />
          <Stack.Screen name="eval" options={{ title: t("HM-DEV-03.title"), headerShown: false }} />
        </Stack>
      </AppLockProvider>
    </HermitProvider>
  );
}
