// Issue 128: which word the copy uses for the phone's biometric. Pure: tested under Node (biometric-name.test.ts).
import type { BiometricKind } from "@hermit/copy";

/** expo-local-authentication's AuthenticationType values. */
const FINGERPRINT = 1;
const FACIAL_RECOGNITION = 2;

/**
 * Android keeps "fingerprint". An iPhone says Face ID or Touch ID from what it supports
 * (supportedAuthenticationTypesAsync), and both names when it reports neither or the read failed.
 */
export function biometricKind(os: string, supported: readonly number[] | undefined): BiometricKind {
  if (os !== "ios") return "fingerprint";
  if (supported?.includes(FACIAL_RECOGNITION)) return "faceId";
  if (supported?.includes(FINGERPRINT)) return "touchId";
  return "faceOrTouchId";
}
