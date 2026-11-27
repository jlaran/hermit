import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

/**
 * SL-40: every answer the payments service gives in the chat (`HM-CHAT-01.pay.*`) and every line it writes on the
 * payment sheet or the wallet's unlock prompt (`HM-APPR-02.*`) has copy in both locales, and uses only the variables
 * the service passes. The app's translator throws on a missing key or variable, so a gap here is a payment the user
 * can't read the outcome of. SL-41: the same for a purchase from a site (src/pay-merchant.ts).
 */
const source = ["../src/pay.ts", "../src/pay-merchant.ts"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
const locales = {
  en: JSON.parse(readFileSync(new URL("../../copy/locales/en.json", import.meta.url), "utf8")) as Record<string, string>,
  "es-419": JSON.parse(readFileSync(new URL("../../copy/locales/es-419.json", import.meta.url), "utf8")) as Record<string, string>,
};

/** What each key may use, from the calls in src/pay.ts. */
const VARS: Record<string, string[]> = {
  "HM-CHAT-01.pay.ambiguous_amount": [],
  "HM-CHAT-01.pay.how_much": [],
  "HM-CHAT-01.pay.not_usdt": [],
  "HM-CHAT-01.pay.which": ["name", "list"],
  "HM-CHAT-01.pay.no_payee": ["name"],
  "HM-CHAT-01.pay.who": [],
  "HM-CHAT-01.pay.not_said": [],
  "HM-CHAT-01.pay.no_wallet": [],
  "HM-CHAT-01.pay.wallet_lost": [],
  "HM-CHAT-01.pay.self": [],
  "HM-CHAT-01.pay.over_per_payment": ["cap"],
  "HM-CHAT-01.pay.over_per_day": ["cap", "left"],
  "HM-CHAT-01.pay.offline": [],
  "HM-CHAT-01.pay.insufficient": ["balance", "amount", "fee"],
  "HM-CHAT-01.pay.failed": [],
  "HM-CHAT-01.pay.expired": [],
  "HM-CHAT-01.pay.cancelled": [],
  "HM-CHAT-01.pay.unconfirmed": ["amount", "to"],
  "HM-CHAT-01.pay.reverted": ["amount", "to"],
  "HM-CHAT-01.pay.sent": ["amount", "to", "hash"],
  "HM-APPR-02.typedValue": [],
  "HM-APPR-02.unlock": ["amount", "to"],
  // SL-41
  "HM-CHAT-01.pay.merchant_no_link": [],
  "HM-CHAT-01.pay.merchant_offline": ["site"],
  "HM-CHAT-01.pay.merchant_free": ["site"],
  "HM-CHAT-01.pay.merchant_unreachable": ["site"],
  "HM-CHAT-01.pay.merchant_unsupported": ["site"],
  "HM-CHAT-01.pay.merchant_other_site": ["site"],
  "HM-CHAT-01.pay.merchant_unreadable": ["site"],
  "HM-CHAT-01.pay.merchant_over_per_payment": ["site", "cap", "amount"],
  "HM-CHAT-01.pay.merchant_insufficient": ["balance", "amount"],
  "HM-CHAT-01.pay.merchant_pending": ["site"],
  "HM-CHAT-01.pay.merchant_paid": ["amount", "site"],
  "HM-CHAT-01.pay.merchant_unconfirmed": ["amount", "site"],
  "HM-APPR-02.validFor": ["minutes"],
  "HM-APPR-02.unlockMerchant": ["amount", "site"],
};

const used = new Set<string>([
  // refuse("code", ...) and refuse(cond ? "code" : "code", ...)
  ...[...source.matchAll(/refuse\((?:[a-z]+ \? "([a-z_]+)" : )?"([a-z_]+)"/g)].flatMap((m) => [m[1], m[2]].filter(Boolean).map((c) => `HM-CHAT-01.pay.${c}`)),
  ...[...source.matchAll(/answer\((?:true|false), "([a-z_]+)"/g)].map((m) => `HM-CHAT-01.pay.${m[1]}`),
  // SL-41: refuse(code ?? "code", ...) and the codes an unpayable offer maps to (OFFER_REFUSAL).
  ...[...source.matchAll(/refuse\([a-z]+ \?\? "([a-z_]+)"/g)].map((m) => `HM-CHAT-01.pay.${m[1]}`),
  ...[...source.matchAll(/^\s+[a-z_]+: "(merchant_[a-z_]+)",$/gm)].map((m) => `HM-CHAT-01.pay.${m[1]}`),
  ...[...source.matchAll(/"(HM-APPR-02\.[a-zA-Z]+)"/g)].map((m) => m[1]!),
]);

const TRANSLATOR_FILLS = ["biometric", "biometricStart", "aBiometric"];

describe("SL-40: the payment copy", () => {
  test("the list here is exactly the keys the service says", () => {
    expect([...used].sort()).toEqual(Object.keys(VARS).sort());
  });

  test.each(Object.entries(VARS))("%s has copy in both locales, using only what the service passes", (key, vars) => {
    for (const dict of Object.values(locales)) {
      const text = dict[key];
      expect(text, key).toBeTypeOf("string");
      // The app's translator fills the biometric's name for this phone (issue 128); the service passes the rest.
      for (const [, name] of text!.matchAll(/\{(\w+)\}/g)) expect([...vars, ...TRANSLATOR_FILLS], `${key} uses {${name}}`).toContain(name);
    }
  });
});
