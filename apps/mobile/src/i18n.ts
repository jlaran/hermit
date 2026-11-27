import { useSyncExternalStore } from "react";
import { biometricWords, createTranslator, resolveLocale, type BiometricKind, type Dictionary, type Locale } from "@hermit/copy";
import en from "@hermit/copy/locales/en.json";
import es from "@hermit/copy/locales/es-419.json";

// CT-10: every string on screen comes from here, keyed by screen ID.
const dictionaries: Record<Locale, Dictionary> = { en, "es-419": es };
// Issue 128: {biometric} and its forms name this phone's biometric (fingerprint on Android, Face ID or Touch ID on an
// iPhone). Fingerprint until setBiometricKind runs at startup.
const translatorsFor = (kind: BiometricKind): Record<Locale, ReturnType<typeof createTranslator>> => ({
  en: createTranslator(en, biometricWords(en, kind)),
  "es-419": createTranslator(es, biometricWords(es, kind)),
});
let translators = translatorsFor("fingerprint");

/** Names the phone's biometric in every string from now on (adapters/fingerprint.ts reads it from the OS). */
export function setBiometricKind(kind: BiometricKind): void {
  translators = translatorsFor(kind);
}

/** The phone's language, resolved to the two Hermit speaks (es-419 for any Spanish, English otherwise). */
export function deviceLocale(): Locale {
  return resolveLocale(Intl.DateTimeFormat().resolvedOptions().locale);
}

// US-ONB-02: the phone's language until the stored override (HM-ONB-02, HM-SET-05) is read; then the override.
let current: Locale = deviceLocale();
const listeners = new Set<() => void>();

/** The language the app shows now, for copy and for Intl dates and numbers. */
export function currentLocale(): Locale {
  return current;
}

/** Switches every screen without a reinstall: screens re-render through `useLocale` (usePalette subscribes to it). */
export function setAppLocale(next: Locale): void {
  if (next === current || !(next in dictionaries)) return;
  current = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, currentLocale);
}

/** Whether a key has copy (for keys built from a skill id, so a new skill falls back instead of throwing). */
export function hasCopy(key: string): boolean {
  return Object.hasOwn(dictionaries[current], key);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  return translators[current](key, vars);
}

/**
 * A count said right: `key.one` when there is exactly one and the copy has that form ("1 vez", not "1 veces"), else
 * `key`. The count fills `{count}` either way.
 */
export function tCount(key: string, count: number, vars: Record<string, string | number> = {}, shown: string = String(count)): string {
  return t(count === 1 && hasCopy(`${key}.one`) ? `${key}.one` : key, { ...vars, count: shown });
}

/** Copy in a given locale, for answers written in the language the user spoke (read_web, SL-22). */
export function translate(language: Locale, key: string, vars?: Record<string, string>): string {
  return translators[language](key, vars);
}
