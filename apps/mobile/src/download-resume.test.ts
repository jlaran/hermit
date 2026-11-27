/// <reference types="node" />
// How a stopped model download resumes on each platform (issue #127). Made-up URL, sizes and resume data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pausesFor, readResumeRecord, resumePlan, resumeRecordText, resumableBytes } from "./download-resume.ts";

const url = "https://example.com/models/made-up.gguf";
const size = 1_000_000;
// A stand-in for the base64 blob NSURLSession produces when a task pauses.
const blob = Buffer.from("<plist>made-up resume data</plist>").toString("base64");
const record = { url, resumeData: blob, bytes: 400_000 };

test("Android resumes from the byte offset of .part, as before", () => {
  assert.deepEqual(resumePlan("android", { from: 400_000, partBytes: 400_000, expectedSize: size }), { kind: "range", offset: 400_000 });
  // Never past what is on disk.
  assert.deepEqual(resumePlan("android", { from: 500_000, partBytes: 400_000, expectedSize: size }), { kind: "range", offset: 400_000 });
  assert.deepEqual(resumePlan("android", { from: size, partBytes: size, expectedSize: size }), { kind: "complete" });
  assert.deepEqual(resumePlan("android", { from: 400_000, partBytes: 0, expectedSize: size }), { kind: "clean" });
  // A stray iOS record never changes the Android path.
  assert.deepEqual(resumePlan("android", { from: 400_000, partBytes: 400_000, expectedSize: size, record }), { kind: "range", offset: 400_000 });
});

test("iOS resumes from the saved NSURLSession resume data, never from a byte offset", () => {
  assert.deepEqual(resumePlan("ios", { from: 400_000, partBytes: 0, expectedSize: size, record }), { kind: "resume_data", resumeData: blob, offset: 400_000 });
});

test("iOS starts clean when the resume data is missing, or when asked to start over", () => {
  assert.deepEqual(resumePlan("ios", { from: 400_000, partBytes: 0, expectedSize: size }), { kind: "clean" });
  assert.deepEqual(resumePlan("ios", { from: 0, partBytes: 0, expectedSize: size, record }), { kind: "clean" });
  assert.deepEqual(resumePlan("android", { from: 0, partBytes: 400_000, expectedSize: size }), { kind: "clean" });
});

test("iOS goes straight to the check when the whole file already sits in .part", () => {
  assert.deepEqual(resumePlan("ios", { from: size, partBytes: size, expectedSize: size }), { kind: "complete" });
  // A .part of the wrong length on iOS is not a byte offset to resume from.
  assert.deepEqual(resumePlan("ios", { from: 400_000, partBytes: 300_000, expectedSize: size }), { kind: "clean" });
});

test("what is stored next to .part: the URL, the resume data and how far it got", () => {
  const text = resumeRecordText(url, blob, 400_000);
  assert.ok(text);
  assert.deepEqual(JSON.parse(text), { v: 1, url, resumeData: blob, bytes: 400_000 });
  assert.deepEqual(readResumeRecord(text, url, size), record);
});

test("nothing is stored when the pause produced no resume data or no bytes", () => {
  assert.equal(resumeRecordText(url, undefined, 400_000), undefined);
  assert.equal(resumeRecordText(url, "", 400_000), undefined);
  assert.equal(resumeRecordText(url, blob, 0), undefined);
});

test("a stale or broken record is ignored, so the download starts clean", () => {
  const good = resumeRecordText(url, blob, 400_000)!;
  assert.equal(readResumeRecord(undefined, url, size), undefined);
  assert.equal(readResumeRecord("not json", url, size), undefined);
  assert.equal(readResumeRecord(good, "https://example.com/models/other.gguf", size), undefined, "another file's record");
  assert.equal(readResumeRecord(resumeRecordText(url, blob, size + 1)!, url, size), undefined, "more bytes than the model has");
  assert.equal(readResumeRecord(resumeRecordText(url, "40000", 400_000)!, url, size), undefined, "Android's offset is not iOS resume data");
  assert.equal(readResumeRecord(JSON.stringify({ v: 2, url, resumeData: blob, bytes: 400_000 }), url, size), undefined, "unknown version");
  assert.equal(readResumeRecord(JSON.stringify({ v: 1, url, resumeData: blob, bytes: "400000" }), url, size), undefined);
});

test("the bytes reported as kept: .part on Android, the saved record on iOS", () => {
  assert.equal(resumableBytes("android", 400_000, record), 400_000);
  assert.equal(resumableBytes("android", 0, record), 0);
  assert.equal(resumableBytes("ios", 0, record), 400_000);
  assert.equal(resumableBytes("ios", 0, undefined), 0);
  assert.equal(resumableBytes("ios", size, record), size, "a finished file waiting for its check");
});

test("only iOS pauses the download to keep its resume data, when the app leaves or the connection drops", () => {
  assert.equal(pausesFor("ios", { appState: "background" }), true);
  assert.equal(pausesFor("ios", { appState: "inactive" }), false, "Control Center or a notification is not leaving");
  assert.equal(pausesFor("ios", { appState: "active" }), false);
  assert.equal(pausesFor("ios", { connected: false }), true);
  assert.equal(pausesFor("ios", { connected: true }), false);
  assert.equal(pausesFor("android", { appState: "background" }), false);
  assert.equal(pausesFor("android", { connected: false }), false);
});
