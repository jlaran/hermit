/**
 * W1 (the S26 session, 2026-11-24, Costa Rica UTC-6) through the composition root: with the app's copy wired, the
 * answers after actions and reads are code's, in the user's language and local time, and "what can you do?" lists the
 * skills on this phone. The engine is a fake that would say the wrong thing if asked. Synthetic names only.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { nodeSql } from "@hermit/sql-node";
import { conversationId, type CalendarEvent } from "@hermit/core";
import { ed25519Signer } from "@hermit/cage";
import { profileById, type CompletionEngine, type EngineRequest } from "@hermit/model";
import { createHermit, type HermitPorts } from "../src/hermit.ts";
import { capabilityAnswer } from "../src/capabilities.ts";

const load = (name: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../../copy/locales/${name}.json`, import.meta.url), "utf8"));
const DICTS = { "es-419": load("es-419"), en: load("en") };
// Like the app's translator, which fills the biometric's name for this phone (issue 128): an Android phone here.
const copy: NonNullable<HermitPorts["copy"]> = (language, key, given = {}) => {
  const text = DICTS[language][key];
  if (text === undefined) throw new Error(`Missing copy key ${key}.`);
  const vars: Record<string, string> = { biometric: DICTS[language]["common.biometric.fingerprint"]!, ...given };
  return text.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
};

const PROFILE = profileById("botpsy-q4-two-stage-nothink")!;
const local = (iso: string) => Date.parse(`${iso}-06:00`);
// Tuesday 2026-11-24, 14:35 in Costa Rica.
const NOW = local("2026-11-24T14:35");
const WRONG = "La alarma ha sido configurada para la semana de 24 de noviembre a las 9:00 AM";

function setup(script: string[], opts: { copy?: boolean; access?: HermitPorts["access"]; web?: boolean } = {}) {
  const requests: EngineRequest[] = [];
  let i = 0;
  const engine: CompletionEngine = {
    async complete(req) {
      requests.push(req);
      return { text: script[i++] ?? WRONG, toolCalls: [] };
    },
  };
  const alarms: number[] = [];
  const events: CalendarEvent[] = [
    // 9:00 in Costa Rica is 15:00 UTC: the S26 said "15:00".
    { title: "Reunión de equipo", start: Date.UTC(2026, 10, 25, 15), end: Date.UTC(2026, 10, 25, 16) },
    { title: "Feriado", start: Date.UTC(2026, 10, 25), end: Date.UTC(2026, 10, 26), allDay: true },
  ];
  const sent: string[] = [];
  let n = 0;
  const sql = nodeSql();
  const hermit = createHermit(
    {
      sql,
      signer: ed25519Signer(new Uint8Array(32).fill(5)),
      notifier: { schedule: async (x) => (alarms.push(x.at), `n${alarms.length}`), cancel: async () => {} },
      calendar: { list: async (f, t) => events.filter((e) => e.start < t && e.end > f), add: async (e) => void events.push(e), calendars: async () => [] },
      replySender: { send: async (_h, text) => (sent.push(text), "sent") },
      engine,
      approvals: { request: async (r) => ({ kind: "approved", biometric: true, argsHash: r.call.argsHash }) },
      now: () => NOW,
      timeZone: () => "America/Costa_Rica",
      language: () => "es-419",
      newId: () => `id${++n}`,
      ...(opts.copy === false ? {} : { copy }),
      ...(opts.access ? { access: opts.access } : {}),
      ...(opts.web ? { web: { fetch: { get: async () => { throw new Error("offline"); } }, copy } } : {}),
    },
    PROFILE,
  );
  return { hermit, sql, requests, alarms, events, sent };
}

describe("W1 replies through the runtime", () => {
  test("a reminder's answer is the real day and local time, and the model writes no reply", async () => {
    const w = setup(['{"choice":"remind","args":{"text":"Llamar a mamá","at":"2026-11-24T09:00"}}']);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const view = await w.hermit.send(s, "recuérdame mañana a las 9 llamar a mamá");
    expect(view).toEqual({ kind: "reply", text: "Listo. Te aviso mañana, miércoles 25, a las 9:00: «Llamar a mamá»." });
    expect(w.alarms).toEqual([local("2026-11-25T09:00")]);
    // One model call (the pick); the answer took none.
    expect(w.requests).toHaveLength(1);
  });

  test("\"¿qué tengo mañana?\": tomorrow's events in local time, all-day ones as dates", async () => {
    const w = setup(['{"choice":"calendar_read","args":{"from":"2026-11-24T12:00:00","to":"2026-11-24T23:59:59"}}']);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const view = await w.hermit.send(s, "¿qué tengo mañana?");
    expect(view).toMatchObject({ kind: "reply", text: "Esto tienes mañana, miércoles 25 de noviembre:\n• Todo el día: «Feriado»\n• 9:00 a 10:00: «Reunión de equipo»", tainted: true });
    expect(w.requests).toHaveLength(1);
    // What the model read was local too.
    const [tool] = await w.sql.query<{ text: string }>("SELECT text FROM chat_turns WHERE role = 'tool'");
    expect(tool!.text).toContain("Wednesday, November 25, 2026, 09:00 (tomorrow) to 10:00: Reunión de equipo");
    expect(tool!.text).not.toContain("15:00");
  });

  test("\"¿Me escribió Ana?\": a listing in code, others' words quoted, kept untrusted", async () => {
    const w = setup(['{"choice":"read_messages","args":{"contact":"Ana"}}']);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    await w.hermit.messages.ingest({ packageName: "com.whatsapp", conversationKey: "ana", title: "Ana", sender: "Ana", text: "Hola", postedAt: local("2026-11-24T14:20"), notificationKey: "k1", replyHandle: "h1" });
    const view = await w.hermit.send(s, "¿Me escribió Ana?");
    expect(view).toMatchObject({ kind: "reply", text: "Ana te escribió a las 14:20: «Hola»", tainted: true });
    const turns = await w.sql.query<{ role: string; untrusted: number; text: string }>("SELECT role, untrusted, text FROM chat_turns ORDER BY id");
    expect(turns.at(-1)).toEqual({ role: "assistant", untrusted: 1, text: "Ana te escribió a las 14:20: «Hola»" });
    expect((await w.hermit.transcript(s)).entries.at(-1)).toEqual({ kind: "reply", text: "Ana te escribió a las 14:20: «Hola»" });
  });

  test("a read then the reply the user asked for: the reply's confirmation, after the fingerprint", async () => {
    const id = conversationId("whatsapp", "ana");
    const w = setup(['{"choice":"read_messages","args":{"contact":"Ana"}}', `{"choice":"reply_message","args":{"conversationId":"${id}","text":"Voy 10 minutos tarde"}}`]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    await w.hermit.messages.ingest({ packageName: "com.whatsapp", conversationKey: "ana", title: "Ana", sender: "Ana", text: "¿Vienes?", postedAt: local("2026-11-24T14:20"), notificationKey: "k1", replyHandle: "h1" });
    const view = await w.hermit.send(s, "dile a Ana que voy 10 minutos tarde");
    expect(w.sent).toEqual(["Voy 10 minutos tarde"]);
    expect(view).toMatchObject({ kind: "reply", text: "Listo, enviado a «Ana»: «Voy 10 minutos tarde»." });
  });

  test("two requests in one message: both run, both confirm, in order", async () => {
    const w = setup(['{"choice":"remind","args":{"text":"Llamar al banco","at":"2026-11-25T09:00"}}', '{"choice":"remember","args":{"fact":"Mi cuenta es 1234"}}']);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const view = await w.hermit.send(s, "recuérdame mañana a las 9 llamar al banco y anota que mi cuenta es 1234");
    expect(view).toEqual({ kind: "reply", text: "Listo. Te aviso mañana, miércoles 25, a las 9:00: «Llamar al banco».\n\nListo, lo recuerdo: tu cuenta es 1234." });
  });

  test("\"¿qué puedes hacer?\" lists only the skills on this phone, in the user's language, with no model call", async () => {
    const w = setup([]);
    await w.hermit.init();
    const s = await w.hermit.startSession();
    const es = await w.hermit.send(s, "¿Qué puedes hacer?");
    expect(es).toEqual({
      kind: "reply",
      text: [
        "Esto puedo hacer en este teléfono:",
        "• Recordarte cosas a la hora que digas, y ver o cancelar tus recordatorios",
        "• Guardar lo que me cuentes y recordártelo cuando lo preguntes",
        "• Ver tu calendario y agregarle eventos",
        "• Leer tus mensajes de WhatsApp y responderlos cuando lo apruebes",
        "Todo pasa en este teléfono. Antes de enviar o pagar algo, te pregunto.",
      ].join("\n"),
    });
    const en = await w.hermit.send(s, "hi! what can you do?");
    expect(en.kind === "reply" && en.text.startsWith("Here's what I can do on this phone:\n• Remind you")).toBe(true);
    expect(w.requests).toHaveLength(0);
  });

  test("without the copy port, the model words its answers as before", async () => {
    const w = setup(['{"choice":"remember","args":{"fact":"Mi pasaporte vence en marzo"}}', '{"choice":"respond"}', "Guardado."], { copy: false });
    await w.hermit.init();
    const s = await w.hermit.startSession();
    expect(await w.hermit.send(s, "recuerda que mi pasaporte vence en marzo")).toEqual({ kind: "reply", text: "Guardado." });
  });
});

describe("capabilityAnswer", () => {
  const t = (key: string, vars?: Record<string, string>) => copy("es-419", key, vars);
  const all = ["remind", "remember", "calendar_read", "read_messages", "mail_list", "read_web", "search_web", "dial", "pay"];
  test("a group shows only when one of its skills is on the menu, in a fixed order", () => {
    expect(capabilityAnswer(["remind", "pay", "read_web", "search_web", "dial"], t, { search: true }).split("\n")).toEqual([
      "Esto puedo hacer en este teléfono:",
      "• Recordarte cosas a la hora que digas, y ver o cancelar tus recordatorios",
      "• Leer páginas web y buscar en internet",
      "• Abrir WhatsApp, tus mensajes, el teléfono, el mapa y otras apps con todo listo",
      "• Enviar pagos en USD₮ dentro de tus límites, con tu huella",
      "Todo pasa en este teléfono. Antes de enviar o pagar algo, te pregunto.",
    ]);
  });

  test("only what this phone can use right now; the rest is named once, as what would unlock it (review 4)", () => {
    expect(capabilityAnswer(all, t, { notifications: false, calendar: false, search: false, mailAccount: false }).split("\n")).toEqual([
      "Esto puedo hacer en este teléfono:",
      "• Recordarte cosas a la hora que digas, y ver o cancelar tus recordatorios",
      "• Guardar lo que me cuentes y recordártelo cuando lo preguntes",
      "• Leer páginas web que me pases",
      "• Abrir WhatsApp, tus mensajes, el teléfono, el mapa y otras apps con todo listo",
      "• Enviar pagos en USD₮ dentro de tus límites, con tu huella",
      "Puedo hacer más con acceso a tu calendario, acceso a tus notificaciones, una cuenta de correo o un buscador, en Ajustes.",
      "Todo pasa en este teléfono. Antes de enviar o pagar algo, te pregunto.",
    ]);
    const open = capabilityAnswer(all, t, { notifications: true, calendar: true, search: true, mailAccount: true });
    expect(open).toContain("• Leer tus mensajes de WhatsApp y responderlos cuando lo apruebes");
    expect(open).toContain("• Ver tu calendario y agregarle eventos");
    expect(open).toContain("• Revisar tu correo, y escribir o enviar correos cuando lo apruebes");
    expect(open).toContain("• Leer páginas web y buscar en internet");
    expect(open).not.toContain("Puedo hacer más");
    expect(capabilityAnswer(all, (key, vars) => copy("en", key, vars), { calendar: false }).split("\n").at(-2)).toBe("I can do more with access to your calendar, in Settings.");
  });

  test("through the runtime: notification access off and no search provider show in the answer", async () => {
    const w = setup([], { access: async () => ({ notifications: false, calendar: true }), web: true });
    await w.hermit.init();
    // Search turned off on HM-SET-02 (unset is DuckDuckGo).
    await w.hermit.settings.set("search.provider", "off");
    const s = await w.hermit.startSession();
    const view = await w.hermit.send(s, "¿Qué puedes hacer?");
    const text = view.kind === "reply" ? view.text : "";
    expect(text).not.toContain("WhatsApp y responderlos");
    expect(text).toContain("• Ver tu calendario y agregarle eventos");
    expect(text).toContain("• Leer páginas web que me pases");
    expect(text).toContain("Puedo hacer más con acceso a tus notificaciones o un buscador, en Ajustes.");
    await w.hermit.settings.set("search.provider", "duckduckgo");
    const again = await w.hermit.send(s, "¿Qué puedes hacer?");
    expect(again.kind === "reply" && again.text).toContain("• Leer páginas web y buscar en internet");
    expect(w.requests).toHaveLength(0);
  });
});
