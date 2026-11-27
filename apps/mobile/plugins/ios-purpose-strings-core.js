// Issue 128: the iOS permission prompts (Info.plist purpose strings), read from packages/copy so they have one source,
// in both locales. Pure: tested by ios-purpose-strings.test.mjs.
"use strict";

const fs = require("node:fs");

/** Each purpose key the Face ID and calendar plugins write, and the copy key that says it. */
const PURPOSE_KEYS = {
  NSFaceIDUsageDescription: "common.ios.faceIdUsage",
  NSCalendarsUsageDescription: "common.ios.calendarsUsage",
  NSCalendarsFullAccessUsageDescription: "common.ios.calendarsUsage",
  NSRemindersUsageDescription: "common.ios.remindersUsage",
  NSRemindersFullAccessUsageDescription: "common.ios.remindersUsage",
};

/** The purpose strings for one locale's dictionary. A missing key fails the prebuild instead of shipping Expo's default. */
function purposeStrings(dict) {
  const out = {};
  for (const [plistKey, copyKey] of Object.entries(PURPOSE_KEYS)) {
    const text = dict[copyKey];
    if (typeof text !== "string" || !text) throw new Error(`Hermit: packages/copy has no ${copyKey} for ${plistKey}.`);
    out[plistKey] = text;
  }
  return out;
}

/** packages/copy's locales, as JSON. */
function readCopy(locale) {
  return JSON.parse(fs.readFileSync(require.resolve(`@hermit/copy/locales/${locale}.json`), "utf8"));
}

module.exports = { PURPOSE_KEYS, purposeStrings, readCopy };
