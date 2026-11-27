// Issue 128: the iOS permission prompts come from packages/copy, in English and Spanish, and replace every default the
// Expo plugins would write. Run through Expo's own Info.plist mods, with no prebuild.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const withIosPurposeStrings = require("./with-ios-purpose-strings.js");
const { PURPOSE_KEYS, purposeStrings } = require("./ios-purpose-strings-core.js");
const plugin = (name) => require(name).default;
const withSecureStore = plugin("expo-secure-store/app.plugin.js");
const withCalendar = plugin("expo-calendar/app.plugin.js");
const withLocalAuthentication = plugin("expo-local-authentication/app.plugin.js");

const en = JSON.parse(fs.readFileSync(new URL("../../../packages/copy/locales/en.json", import.meta.url), "utf8"));
const es = JSON.parse(fs.readFileSync(new URL("../../../packages/copy/locales/es-419.json", import.meta.url), "utf8"));
const app = JSON.parse(fs.readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;

const EXPO_DEFAULT = /Allow \$\(PRODUCT_NAME\)/;

test("every Info.plist purpose key the calendar and Face ID plugins write has copy in both locales", () => {
  for (const plistKey of ["NSFaceIDUsageDescription", "NSCalendarsUsageDescription", "NSCalendarsFullAccessUsageDescription", "NSRemindersUsageDescription", "NSRemindersFullAccessUsageDescription"]) {
    const copyKey = PURPOSE_KEYS[plistKey];
    assert.ok(copyKey, plistKey);
    assert.ok(en[copyKey], `${copyKey} in en`);
    assert.ok(es[copyKey], `${copyKey} in es-419`);
  }
  assert.deepEqual(Object.keys(purposeStrings(en)).sort(), Object.keys(purposeStrings(es)).sort());
  assert.throws(() => purposeStrings({}), /common\.ios\./);
});

test("the plugin writes the English prompts to Info.plist and both languages to InfoPlist.strings", async () => {
  // The order app.json uses: ours, then the plugins whose defaults it replaces.
  let config = { name: "Hermit", slug: "hermit", ios: {} };
  config = withIosPurposeStrings(config);
  config = withSecureStore(config);
  config = withLocalAuthentication(config, { faceIDPermission: false });
  config = withCalendar(config);
  const result = await config.mods.ios.infoPlist({ ...config, modResults: { ...config.ios.infoPlist }, modRequest: { platform: "ios", modName: "infoPlist", projectRoot: "/app", platformProjectRoot: "/app/ios", introspect: true } });
  const plist = result.modResults;
  for (const [plistKey, copyKey] of Object.entries(PURPOSE_KEYS)) {
    assert.equal(plist[plistKey], en[copyKey], plistKey);
    assert.doesNotMatch(plist[plistKey], EXPO_DEFAULT, plistKey);
    assert.equal(config.locales.en[plistKey], en[copyKey]);
    assert.equal(config.locales.es[plistKey], es[copyKey]);
  }
});

test("app.json lists the plugin before the plugins whose defaults it replaces", () => {
  const names = app.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  const ours = names.indexOf("./plugins/with-ios-purpose-strings");
  assert.ok(ours >= 0, "listed");
  for (const other of ["expo-secure-store", "expo-local-authentication", "expo-calendar"]) assert.ok(ours < names.indexOf(other), other);
});
