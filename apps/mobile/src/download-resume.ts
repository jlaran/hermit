// How a stopped model download resumes on each platform (issue #127). Pure: tested under Node with node --test
// (download-resume.test.ts); the adapter in adapters/device.ts does the file and network work.
//
// Android (expo-file-system) resumes from a byte offset: the native task truncates `.part` to it and appends with an
// HTTP Range request. iOS never writes `.part` until the file is complete; NSURLSession keeps the bytes itself and
// resumes only from the opaque base64 blob it produced when the task was paused, so that blob is what is kept, in a
// small record next to `.part`. A missing, stale or rejected record means a clean restart. The SHA-256 check on the
// finished file runs the same on both paths.

const isIos = (os: string) => os === "ios";

/** What is saved next to `.part` on iOS when a download pauses. */
export interface ResumeRecord {
  url: string;
  /** NSURLSession's resume data, base64, as expo-file-system returns it from a pause. */
  resumeData: string;
  /** How many bytes had arrived when it paused, for the progress bar and the state machine. */
  bytes: number;
}

export type ResumePlan =
  | { kind: "clean" }
  | { kind: "complete" }
  | { kind: "range"; offset: number }
  | { kind: "resume_data"; resumeData: string; offset: number };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const isBase64 = (s: string) => s.length % 4 === 0 && BASE64.test(s);
const isBytes = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;

/** The record's text, or undefined when the pause left nothing to resume from (no resume data, or no bytes yet). */
export function resumeRecordText(url: string, resumeData: string | null | undefined, bytes: number): string | undefined {
  if (!resumeData || !isBytes(bytes)) return undefined;
  return JSON.stringify({ v: 1, url, resumeData, bytes });
}

/** The saved record, only when it is for this URL, well formed and no longer than the model; else undefined. */
export function readResumeRecord(text: string | undefined, url: string, size?: number): ResumeRecord | undefined {
  if (!text) return undefined;
  let r: unknown;
  try {
    r = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof r !== "object" || r === null) return undefined;
  const o = r as Record<string, unknown>;
  if (o.v !== 1 || o.url !== url || typeof o.resumeData !== "string" || !isBase64(o.resumeData) || !isBytes(o.bytes)) return undefined;
  if (size !== undefined && o.bytes > size) return undefined;
  return { url, resumeData: o.resumeData, bytes: o.bytes };
}

/**
 * Which path a download attempt takes. `from` is the state machine's `downloading.from` (0 means start clean),
 * `partBytes` the length of `.part` on disk, `record` the saved iOS resume data, already read and checked.
 */
export function resumePlan(os: string, x: { from: number; partBytes: number; expectedSize?: number; record?: ResumeRecord }): ResumePlan {
  if (x.from <= 0) return { kind: "clean" };
  if (isIos(os)) {
    // A finished file waiting for its check (the app stopped before hashing): straight to the check, which still runs.
    if (x.partBytes > 0 && x.partBytes === x.expectedSize) return { kind: "complete" };
    return x.record ? { kind: "resume_data", resumeData: x.record.resumeData, offset: x.record.bytes } : { kind: "clean" };
  }
  const offset = Math.min(x.from, x.partBytes);
  if (offset <= 0) return { kind: "clean" };
  return offset === x.expectedSize ? { kind: "complete" } : { kind: "range", offset };
}

/** The bytes a download can resume from: `.part` on disk, or on iOS before it exists, the saved record. */
export function resumableBytes(os: string, partBytes: number, record: ResumeRecord | undefined): number {
  if (partBytes > 0) return partBytes;
  return isIos(os) && record ? record.bytes : 0;
}

/**
 * Whether to pause the running download now so its resume data is kept. Only iOS: expo-file-system hands back the
 * resume data from a pause, never from a failure, and an app closed while in the background loses it. Android keeps
 * `.part` on disk and needs nothing.
 */
export function pausesFor(os: string, signal: { appState?: string; connected?: boolean }): boolean {
  if (!isIos(os)) return false;
  return signal.appState === "background" || signal.connected === false;
}
