import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import { biometricKind } from "../biometric-name";
import { setBiometricKind } from "../i18n";

export type FingerprintCheck = "confirmed" | "not_confirmed" | "unavailable";

/**
 * SL-32 (US-ACT-04): a strong-biometric check with no PIN fallback, the same bar as approvals (Q49).
 * "unavailable" means the phone has no strong biometric enrolled, so the screen can say how to fix it.
 */
export async function confirmWithFingerprint(prompt: string, cancelLabel: string): Promise<FingerprintCheck> {
  const [hardware, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
  if (!hardware || !enrolled) return "unavailable";
  const auth = await LocalAuthentication.authenticateAsync({
    promptMessage: prompt,
    cancelLabel,
    biometricsSecurityLevel: "strong",
    disableDeviceFallback: true,
  });
  return auth.success ? "confirmed" : "not_confirmed";
}

/** Issue 128: the copy names this phone's biometric: Face ID or Touch ID on an iPhone, fingerprint on Android. */
export async function applyBiometricName(): Promise<void> {
  const supported = Platform.OS === "ios" ? await LocalAuthentication.supportedAuthenticationTypesAsync().catch(() => undefined) : undefined;
  setBiometricKind(biometricKind(Platform.OS, supported));
}
