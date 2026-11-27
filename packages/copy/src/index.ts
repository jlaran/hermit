/**
 * CT-10: copy and locales. Every string a person sees has a key `screenId.element`
 * (for example `HM-APPR-01.approve`) or `common.*`, in es-419 and English.
 */
export type Locale = "en" | "es-419";
export type Dictionary = Readonly<Record<string, string>>;

export const LOCALES: readonly Locale[] = ["es-419", "en"];

/** Any Spanish locale (es, es-CR, es-MX, es-ES...) gets es-419; everything else gets English (ADR-013). */
export function resolveLocale(tag: string | undefined, override?: Locale): Locale {
  if (override) return override;
  return tag && /^es\b/i.test(tag) ? "es-419" : "en";
}

export const KEY_PATTERN = /^(HM-[A-Z0-9]+-\d{2}|common)\.[a-z][a-zA-Z0-9]*(\.[a-z_][a-zA-Z0-9_]*)*$/;

export class CopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopyError";
  }
}

/**
 * Looks a key up and fills `{name}` placeholders. A missing key throws in tests and dev,
 * so a screen can't ship with a hard-coded or forgotten string. `defaults` fill what a call doesn't pass, such as the
 * biometric's name for this phone (`biometricWords`).
 */
export function createTranslator(dict: Dictionary, defaults: Record<string, string> = {}) {
  return function t(key: string, given: Record<string, string | number> = {}): string {
    const vars: Record<string, string | number> = { ...defaults, ...given };
    const text = dict[key];
    if (text === undefined) throw new CopyError(`Missing copy key ${key}.`);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => {
      if (!(name in vars)) throw new CopyError(`Copy key ${key} needs {${name}}.`);
      return String(vars[name]);
    });
  };
}

/** Issue 128: the iOS permission prompts, written into the app's Info.plist by apps/mobile/plugins/with-ios-purpose-strings. */
export const IOS_PURPOSE_KEYS = ["common.ios.faceIdUsage", "common.ios.calendarsUsage", "common.ios.remindersUsage"] as const;

/**
 * Issue 128: what the phone calls its biometric. Android says fingerprint; an iPhone says Face ID or Touch ID, or both
 * when it can't tell which it has.
 */
export const BIOMETRIC_KINDS = ["fingerprint", "faceId", "touchId", "faceOrTouchId"] as const;
export type BiometricKind = (typeof BIOMETRIC_KINDS)[number];

/**
 * The `{biometric}`, `{biometricStart}` (at the start of a sentence) and `{aBiometric}` (with "a" where the word takes
 * one) placeholders for one kind, from `common.biometric.*`. The app passes them to `createTranslator` as defaults.
 */
export function biometricWords(dict: Dictionary, kind: BiometricKind): Record<"biometric" | "biometricStart" | "aBiometric", string> {
  const word = (form: string) => {
    const key = `common.biometric.${kind}${form}`;
    const text = dict[key];
    if (text === undefined) throw new CopyError(`Missing copy key ${key}.`);
    return text;
  };
  return { biometric: word(""), biometricStart: word(".start"), aBiometric: word(".a") };
}

/** The placeholders a string uses, so both locales can be checked to agree. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}
