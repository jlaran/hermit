/// <reference types="node" />
// HM-SET-10, the Device lab: the report in plain words, and the link that opens the GitHub form with it filled in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTranslator, type Dictionary } from "@hermit/copy";
import { clockText, fileReport, issueLink, MAX_FORM_URL, REPORT_FORM_URL, reportGroups, reportText } from "./device-lab-view.ts";

const locale = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/copy/locales/${name}.json`, import.meta.url), "utf8")) as Dictionary;
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../scripts/devices/fixtures/${name}`, import.meta.url), "utf8"));
const report = fixture("good-report-android.json");
const iphone = fixture("good-report-iphone.json");
const en = createTranslator(locale("en"));
const es = createTranslator(locale("es-419"));

const flat = (groups: ReturnType<typeof reportGroups>) => groups.flatMap((g) => [g.title, ...g.rows.flatMap((r) => [r.label, r.value])]).join("\n");

test("the report in plain words: every part of it, in both languages, with no key or placeholder missing", () => {
  for (const r of [report, iphone]) {
    for (const [t, tag] of [[en, "en"], [es, "es-419"]] as const) {
      const groups = reportGroups(r, t, tag);
      assert.deepEqual(groups.map((g) => g.rows.length > 0), [true, true, true, true, true]);
      for (const g of groups) for (const row of g.rows) assert.ok(row.label.trim() && row.value.trim(), `${tag}: ${g.title}`);
      assert.ok(!/\{\w+\}/.test(flat(groups)), `${tag}: a placeholder was left unfilled`);
    }
  }
  const text = flat(reportGroups(report, en, "en"));
  for (const shown of [
    "Examplecorp EX-1000", "Examplechip XC9000", "7.5 GB", "Android\n15 (API 35)", "8 cores, arm64-v8a", "4 at 2.0 GHz, 3 at 2.6 GHz, 1 at 3.1 GHz",
    "dotprod, i8mm", "4 threads, mid-range plan", "0-7 (top-app)", "cores mask f0", "thinking up to 256 tokens", "Context of 8,192 tokens, batches of 512, 4 threads reading",
    "cool at the start, a little warm at most", "18.4 tokens a second with 4 threads", "72.5 tokens a second", "4.8 s", "3.9 s",
    "With 2 threads", "writes 11.2 tokens a second", "first token in 8.6 s", "11 of 12", "31.0 s", "47.0 s",
    "es-remind-1", "Right, 30.5 s", "Wrong, 47.0 s: picked respond", "9 min 12 s", "Once, 45 s", "2026-11-25", "Hermit 0.1.0, botpsy-q4-native-think256",
  ]) assert.ok(text.includes(shown), `missing: ${shown}\n${text}`);
});

test("an iPhone's report reads as an iPhone: its model identifier and iOS version, and no Android API level, ABI or chip", () => {
  const text = flat(reportGroups(iphone, en, "en"));
  for (const shown of ["Apple iPhone 99 Example", "Model identifier\niPhone99,1", "iOS\n27.0", "Processor\n6 cores\n", "hot at most"]) assert.ok(text.includes(shown), `missing: ${shown}\n${text}`);
  for (const hidden of ["API", "Android", "arm64", "Chip", "Top clock"]) assert.ok(!text.includes(hidden), `shown: ${hidden}\n${text}`);
  const es419 = flat(reportGroups(iphone, es, "es-419"));
  for (const shown of ["Identificador del modelo\niPhone99,1", "iOS\n27.0", "Procesador\n6 núcleos\n"]) assert.ok(es419.includes(shown), `missing: ${shown}\n${es419}`);
});

test("the lab's words that show on every phone don't say Android", () => {
  for (const name of ["en", "es-419"]) {
    const d = locale(name);
    for (const key of ["HM-SET-10.whatFacts", "HM-SET-10.never", "HM-SET-10.exactNote", "HM-SET-10.shareBody"]) assert.ok(d[key] && !/Android/.test(d[key]!), `${name}: ${key}`);
  }
});

test("File it on GitHub works for an iPhone's report too: the title names the iPhone", () => {
  const link = issueLink(iphone);
  assert.equal(link.prefilled, true);
  const url = new URL(link.url);
  assert.equal(url.searchParams.get("title"), "Device report: Apple iPhone 99 Example");
  assert.deepEqual(JSON.parse(url.searchParams.get("report")!), iphone);
});

test("what the phone couldn't say reads as unknown, and no processor feature reads as none", () => {
  const bare = JSON.parse(JSON.stringify(report));
  bare.device.cpuFeatures = { dotprod: false, i8mm: false, sve2: false, sme2: false };
  bare.runtime.allowedCpus = "unknown";
  delete bare.runtime.cpuset;
  delete bare.device.coreMaxMHz;
  bare.run.thermalPauses = 0;
  bare.run.pausedMs = 0;
  const text = flat(reportGroups(bare, en, "en"));
  for (const shown of ["None of the ones the model uses", "Cores Hermit may use\nUnknown", "Pauses for heat\nNone"]) assert.ok(text.includes(shown), `missing: ${shown}`);
  assert.ok(!text.includes("Top clock of each core"));
});

test("File it on GitHub: the form's link carries the report, the title names the phone", () => {
  const link = issueLink(report);
  assert.equal(link.prefilled, true);
  const url = new URL(link.url);
  assert.equal(`${url.origin}${url.pathname}`, REPORT_FORM_URL);
  assert.equal(url.searchParams.get("template"), "device_report.yml");
  assert.equal(url.searchParams.get("title"), "Device report: Examplecorp EX-1000");
  assert.deepEqual(JSON.parse(url.searchParams.get("report")!), report);
  assert.ok(link.url.length <= MAX_FORM_URL);
});

test("a report too long for a link opens the empty form instead", () => {
  const long = JSON.parse(JSON.stringify(report));
  long.device.model = "M".repeat(40);
  long.speed.sweep = Array.from({ length: 200 }, (_, i) => ({ threads: i + 1, tokensPerSecond: 1, loadMs: 1 }));
  const link = issueLink(long);
  assert.equal(link.prefilled, false);
  assert.equal(new URL(link.url).searchParams.get("report"), null);
  assert.equal(new URL(link.url).searchParams.get("template"), "device_report.yml");
});

/** A made-up phone for File it on GitHub: what it copied and opened, in order, and which of the two fail. */
const phoneFor = (fail: { copy?: boolean; open?: boolean } = {}) => {
  const calls: string[][] = [];
  return {
    calls,
    io: {
      copy: async (text: string) => {
        calls.push(["copy", text]);
        if (fail.copy) throw new Error("no clipboard");
      },
      open: async (url: string) => {
        calls.push(["open", url]);
        if (fail.open) throw new Error("no handler");
      },
    },
  };
};

const tooLong = () => {
  const long = JSON.parse(JSON.stringify(report));
  long.device.model = "M".repeat(40);
  long.speed.sweep = Array.from({ length: 200 }, (_, i) => ({ threads: i + 1, tokensPerSecond: 1, loadMs: 1 }));
  return long;
};

test("File it on GitHub copies the exact report first, then opens the filled-in form, on every phone", async () => {
  for (const r of [report, iphone]) {
    const phone = phoneFor();
    const notice = await fileReport(r, phone.io);
    assert.deepEqual(phone.calls, [["copy", reportText(r)], ["open", issueLink(r).url]]);
    assert.equal(issueLink(r).prefilled, true);
    assert.equal(notice, "fileCopied");
  }
});

test("a report too long for a link is copied the same way, and the empty form opens", async () => {
  const long = tooLong();
  const phone = phoneFor();
  assert.equal(await fileReport(long, phone.io), "longCopied");
  assert.deepEqual(phone.calls, [["copy", reportText(long)], ["open", issueLink(long).url]]);
  assert.equal(new URL(phone.calls[1]![1]!).searchParams.get("report"), null);
});

test("when the copy fails, a filled-in form still opens, but an empty one doesn't", async () => {
  const filled = phoneFor({ copy: true });
  assert.equal(await fileReport(report, filled.io), undefined);
  assert.deepEqual(filled.calls.map((c) => c[0]), ["copy", "open"]);
  const empty = phoneFor({ copy: true });
  assert.equal(await fileReport(tooLong(), empty.io), "copyFailed");
  assert.deepEqual(empty.calls.map((c) => c[0]), ["copy"]);
});

test("when nothing can open the link, the screen says so", async () => {
  assert.equal(await fileReport(report, phoneFor({ open: true }).io), "openFailed");
  assert.equal(await fileReport(tooLong(), phoneFor({ open: true }).io), "openFailed");
});

test("what File it on GitHub says: the report is copied, paste it into Report if the form opens empty, or pick Device report", () => {
  for (const name of ["en", "es-419"]) {
    const d = locale(name);
    for (const key of ["HM-SET-10.fileCopied", "HM-SET-10.longCopied"]) {
      assert.ok(d[key], `${name}: ${key} is missing`);
      assert.ok(d[key]!.includes("Report") && d[key]!.includes("Device report"), `${name}: ${key}`);
      assert.ok(!/[\u2013\u2014]/.test(d[key]!), `${name}: ${key} has a dash`);
    }
    assert.ok(!/Android/.test(d["HM-SET-10.fileCopied"]!), `${name}: fileCopied says Android`);
  }
});

test("the exact text is the report's JSON, and nothing else", () => {
  assert.deepEqual(JSON.parse(reportText(report)), report);
  assert.equal(reportText(report), JSON.stringify(report, null, 2));
});

test("the time so far reads minutes and seconds", () => {
  assert.equal(clockText(0), "0:00");
  assert.equal(clockText(65_400), "1:05");
  assert.equal(clockText(600_000), "10:00");
});
