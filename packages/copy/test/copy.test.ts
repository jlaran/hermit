import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { OUTCOMES, outcomeCopyKey } from "@hermit/core";
import { BIOMETRIC_KINDS, biometricWords, createTranslator, CopyError, IOS_PURPOSE_KEYS, KEY_PATTERN, placeholders, resolveLocale, type Dictionary } from "../src/index.ts";

const load = (name: string): Dictionary => JSON.parse(readFileSync(new URL(`../locales/${name}.json`, import.meta.url), "utf8"));
const en = load("en");
const es = load("es-419");

describe("locale files (CT-10)", () => {
  test("both locales define exactly the same keys", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  test("keys follow screenId.element or common.*", () => {
    for (const k of Object.keys(en)) expect(k, k).toMatch(KEY_PATTERN);
  });

  test("placeholders agree across locales", () => {
    for (const k of Object.keys(en)) expect(placeholders(es[k]!), k).toEqual(placeholders(en[k]!));
  });

  test("every user-facing outcome (CT-04) has copy", () => {
    for (const o of OUTCOMES) {
      expect(en[outcomeCopyKey(o)], o).toBeTruthy();
      expect(es[outcomeCopyKey(o)], o).toBeTruthy();
    }
  });

  test("no em or en dashes in copy (house style)", () => {
    for (const [k, v] of [...Object.entries(en), ...Object.entries(es)]) expect(v, k).not.toMatch(/[–—]/);
  });
});

describe("translator", () => {
  test("fills placeholders", () => {
    expect(createTranslator(es)("HM-ACT-03.title", { index: 7 })).toBe("Cadena rota en la entrada 7");
  });

  test("a missing key or variable throws instead of shipping a blank", () => {
    const t = createTranslator(en);
    expect(() => t("HM-NOPE-01.title")).toThrow(CopyError);
    expect(() => t("HM-ACT-03.title")).toThrow(/needs \{index\}/);
  });
});

describe("resolveLocale (ADR-013)", () => {
  test("any Spanish gets es-419, everything else English", () => {
    expect(resolveLocale("es-CR")).toBe("es-419");
    expect(resolveLocale("es")).toBe("es-419");
    expect(resolveLocale("ES-es")).toBe("es-419");
    expect(resolveLocale("pt-BR")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale("pt-BR", "es-419")).toBe("es-419");
  });
});

describe("iOS purpose strings (issue 128)", () => {
  test("every system prompt Hermit can show on an iPhone has copy in both locales, with no placeholders", () => {
    expect(IOS_PURPOSE_KEYS.length).toBeGreaterThan(0);
    for (const k of IOS_PURPOSE_KEYS) {
      expect(en[k], k).toBeTruthy();
      expect(es[k], k).toBeTruthy();
      expect(placeholders(en[k]!), k).toEqual([]);
      expect(es[k], k).not.toEqual(en[k]);
    }
  });
});

describe("the biometric's name by platform (issue 128)", () => {
  const BIOMETRIC = ["aBiometric", "biometric", "biometricStart"];
  const usesBiometric = (k: string) => placeholders(en[k]!).some((p) => BIOMETRIC.includes(p));

  test("each kind has every form in both locales", () => {
    for (const dict of [en, es]) {
      for (const kind of BIOMETRIC_KINDS) {
        const words = biometricWords(dict, kind);
        expect(Object.keys(words).sort()).toEqual(BIOMETRIC);
        for (const w of Object.values(words)) expect(w, kind).toBeTruthy();
      }
    }
  });

  test("Android says fingerprint, an iPhone says Face ID or Touch ID", () => {
    const t = (dict: Dictionary, kind: (typeof BIOMETRIC_KINDS)[number]) => createTranslator(dict, biometricWords(dict, kind));
    expect(t(en, "fingerprint")("HM-APPR-01.approve")).toBe("Approve with fingerprint");
    expect(t(en, "faceId")("HM-APPR-01.approve")).toBe("Approve with Face ID");
    expect(t(en, "touchId")("HM-APPR-01.approve")).toBe("Approve with Touch ID");
    expect(t(es, "fingerprint")("HM-APPR-01.approve")).toBe("Aprobar con huella");
    expect(t(es, "faceId")("HM-APPR-01.approve")).toBe("Aprobar con Face ID");
    expect(t(en, "faceId")("HM-SET-01.perm.fingerprint")).toBe("Face ID");
    expect(t(en, "fingerprint")("HM-SET-01.perm.fingerprint")).toBe("Fingerprint");
  });

  test("a call's own value still wins over the defaults", () => {
    expect(createTranslator({ "common.x": "{a}" }, { a: "default" })("common.x", { a: "given" })).toBe("given");
  });

  test("every string that names the biometric renders for every kind, with no leftover fingerprint or Android", () => {
    const keys = Object.keys(en).filter(usesBiometric);
    expect(keys.length).toBeGreaterThan(50);
    for (const [dict, word] of [[en, /fingerprint|Android/i], [es, /huella|Android/i]] as const) {
      for (const kind of BIOMETRIC_KINDS.filter((k) => k !== "fingerprint")) {
        const t = createTranslator(dict, biometricWords(dict, kind));
        for (const k of keys) expect(t(k, Object.fromEntries(placeholders(dict[k]!).map((p) => [p, "1"]))), `${kind} ${k}`).not.toMatch(word);
      }
    }
  });

  test("no copy outside the Device lab names the fingerprint directly, except a hash's fingerprint", () => {
    const HASH = new Set(["HM-ONB-03.checkedSub", "HM-APPR-01.argsHash", "HM-CONN-05.clientHelp.google"]);
    for (const [dict, word] of [[en, /fingerprint/i], [es, /huella/i]] as const) {
      for (const [k, v] of Object.entries(dict)) {
        if (HASH.has(k) || k.startsWith("HM-SET-10.") || k.startsWith("common.biometric.") || k.startsWith("common.ios.")) continue;
        expect(v, k).not.toMatch(word);
      }
    }
  });
});
