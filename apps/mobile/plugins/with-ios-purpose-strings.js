// Issue 128: Expo config plugin that writes the iOS permission prompts from packages/copy. Info.plist gets the English
// text, in place of the defaults expo-secure-store and expo-calendar would write, and `locales` gets English and Spanish,
// so prebuild writes en.lproj and es.lproj InfoPlist.strings. iOS uses es.lproj for any Spanish, as resolveLocale does.
//
// app.json: "./plugins/with-ios-purpose-strings", listed before expo-secure-store, expo-local-authentication and
// expo-calendar. Mods run last-listed first, so this one runs after theirs and its text is what stays.
"use strict";

const { withInfoPlist } = require("expo/config-plugins");
const { purposeStrings, readCopy } = require("./ios-purpose-strings-core.js");

function withIosPurposeStrings(config) {
  const en = purposeStrings(readCopy("en"));
  const es = purposeStrings(readCopy("es-419"));
  config.locales = { ...config.locales, en: { ...config.locales?.en, ...en }, es: { ...config.locales?.es, ...es } };
  return withInfoPlist(config, (c) => {
    Object.assign(c.modResults, en);
    return c;
  });
}

module.exports = withIosPurposeStrings;
