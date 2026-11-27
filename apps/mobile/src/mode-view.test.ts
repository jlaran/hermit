import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUTO_SHEET_KEYS, DONT_ASK_SHEET_KEYS, canConfirmDontAsk, modeStep } from "./mode-view.ts";

const locale = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/copy/locales/${name}.json`, import.meta.url), "utf8")) as Record<string, string>;
const es = locale("es-419");
const en = locale("en");

test("HM-BOT-04: raising a mode warns; lowering it doesn't", () => {
  assert.equal(modeStep("ask", "auto"), "auto_sheet");
  assert.equal(modeStep("auto", "dont_ask"), "dont_ask_sheet");
  assert.equal(modeStep("ask", "dont_ask"), "dont_ask_sheet");
  assert.equal(modeStep("dont_ask", "ask"), "none");
  assert.equal(modeStep("auto", "auto"), "none");
  assert.equal(modeStep("dont_ask", "auto"), "none");
  assert.equal(modeStep("dont_ask", "dont_ask"), "none");
});

test("HM-BOT-04: the sheet follows the bot's own mode, as the runtime does, never the global one (Task 18, ruling 5)", () => {
  // null is "Como el resto", or a new bot's nothing before. An own Don't ask takes the red sheet, the word and the
  // fingerprint whatever the global mode is: the runtime asks for both also under a global Don't ask.
  assert.equal(modeStep(null, "dont_ask"), "dont_ask_sheet");
  // Going back to the global mode needs nothing: the global took its own warning when it was set.
  assert.equal(modeStep("ask", null), "none");
  assert.equal(modeStep("auto", null), "none");
  assert.equal(modeStep("dont_ask", null), "none");
  // An own Auto warns as it comes in; an own Ask needs nothing.
  assert.equal(modeStep(null, "auto"), "auto_sheet");
  assert.equal(modeStep(null, "ask"), "none");
  assert.equal(modeStep(null, null), "none");
});

test("HM-BOT-04: Don't ask's Confirm waits for the word", () => {
  assert.equal(canConfirmDontAsk(""), false);
  assert.equal(canConfirmDontAsk("si"), false);
  assert.equal(canConfirmDontAsk("Entiendo"), true);
  assert.equal(canConfirmDontAsk(" I understand. "), true);
});

test("HM-BOT-04: the sheets say what the spec says, word for word", () => {
  assert.equal(es["HM-BOT-04.dontAskSheet.risk"], "Una página web podría hacer que Hermit envíe mensajes o correos en tu nombre, borre cosas o comparta tus datos.");
  assert.equal(en["HM-BOT-04.dontAskSheet.risk"], "A web page could make Hermit send messages or emails in your name, delete things or share your data.");
  // Task 18 (ruling 7): web reads no longer feed Auto's links, so the sheet names where its links come from.
  assert.match(es["HM-BOT-04.autoSheet.runs"]!, /abre enlaces que aparecen en tus mensajes y correos/);
  assert.match(en["HM-BOT-04.autoSheet.runs"]!, /opens links that appear in your messages and mail/);
  assert.equal(es["HM-BOT-04.autoSheet.alone"], "Cuando trabaja sin ti, no puede leer tus datos privados y usar la web en la misma tarea.");
  assert.equal(en["HM-BOT-04.autoSheet.alone"], "When it works alone, it can't read your private data and use the web in the same task.");
  assert.equal(es["HM-BOT-04.dontAskSheet.typeWord"], "Escribe entiendo para seguir");
  assert.equal(en["HM-BOT-04.dontAskSheet.typeWord"], "Type I understand to continue");
});

test("HM-BOT-04: the Auto sheet names what really runs, in both languages (F-M21)", () => {
  const points: Record<string, [RegExp, RegExp]> = {
    "HM-BOT-04.autoSheet.runs": [/busca en la web aunque haya leído texto ajeno y abre enlaces que aparecen en tus mensajes y correos/, /searches the web even after reading others' text, and opens links that appear in your messages and mail/],
    "HM-BOT-04.autoSheet.links": [/mensaje o correo con muchos enlaces.*cuál abre/, /message or email with many links.*which one it opens/],
    "HM-BOT-04.autoSheet.query": [/tu buscador.*consulta que escribió Hermit.*lo que leyó/, /your search provider.*query Hermit wrote.*what it read/],
    "HM-BOT-04.autoSheet.mail": [/confirmar, cancelar suscripción o iniciar sesión.*tu correo y tus mensajes/, /confirm, unsubscribe or sign-in links.*your mail and messages/],
    "HM-BOT-04.autoSheet.composed": [/enlace que Hermit arma.*sigue pidiendo/, /link Hermit builds itself still asks/],
    "HM-BOT-04.autoSheet.asks": [/responder.*enviar un correo.*datos de otra persona/, /replying.*sending an email.*someone else's data/],
    "HM-BOT-04.autoSheet.money": [/pagos y los inicios de sesión.*\{biometric\}/, /[Pp]ayments and logins.*\{biometric\}/],
  };
  for (const [key, [e, n]] of Object.entries(points)) {
    assert.match(es[key] ?? "", e, `es ${key}`);
    assert.match(en[key] ?? "", n, `en ${key}`);
    assert.ok(AUTO_SHEET_KEYS.includes(key as never), `${key} is on the sheet`);
  }
  assert.ok(AUTO_SHEET_KEYS.includes("HM-BOT-04.autoSheet.alone"));
  // A web page's links don't open without asking in Auto any more: no line says they do (Task 18, ruling 7).
  for (const key of AUTO_SHEET_KEYS) {
    assert.doesNotMatch(es[key] ?? "", /enlaces[^.]*texto ajeno|página con muchos enlaces/, `es ${key}`);
    assert.doesNotMatch(en[key] ?? "", /links[^.]*others' text|page with many links/, `en ${key}`);
  }
});

test("HM-BOT-04: the Don't ask sheet names the connected tools, the money and the proof, in both languages", () => {
  assert.match(es["HM-BOT-04.dontAskSheet.tools"]!, /herramientas de servicios conectados.*sin preguntar.*no siempre puede.*mueve dinero/);
  assert.match(en["HM-BOT-04.dontAskSheet.tools"]!, /Tools from connected services run without asking.*can't always tell whether.*moves money/);
  assert.match(es["HM-BOT-04.dontAskSheet.money"]!, /pagos y los inicios de sesión.*\{biometric\}.*todos los modos/);
  assert.match(en["HM-BOT-04.dontAskSheet.money"]!, /Payments and logins.*\{biometric\}.*every mode/);
  assert.match(es["HM-BOT-04.dontAskSheet.proof"]!, /\{biometric\}.*escribir/);
  assert.match(en["HM-BOT-04.dontAskSheet.proof"]!, /\{biometric\}.*type/);
  for (const k of ["risk", "tools", "money", "proof", "typeWord"]) assert.ok(DONT_ASK_SHEET_KEYS.includes(`HM-BOT-04.dontAskSheet.${k}` as never), k);
});

test("HM-BOT-04: every sheet key exists in both languages, with no dashes and the same placeholders", () => {
  for (const key of [...AUTO_SHEET_KEYS, ...DONT_ASK_SHEET_KEYS, "HM-BOT-04.autoSheet.confirm", "HM-BOT-04.dontAskSheet.confirm"]) {
    for (const [name, file] of [["es-419", es], ["en", en]] as const) {
      const text = file[key];
      assert.ok(text, `${name} ${key}`);
      assert.doesNotMatch(text, /[–—]/, `${name} ${key} has a dash`);
    }
    assert.deepEqual(es[key]!.match(/\{\w+\}/g) ?? [], en[key]!.match(/\{\w+\}/g) ?? [], key);
  }
});

test("HM-BOT-03: one set of mode words (the placeholder 'coming soon' is gone)", () => {
  assert.equal(es["HM-BOT-03.modeSoon"], undefined);
  assert.equal(en["HM-BOT-03.modeSoon"], undefined);
});
