/// <reference types="node" />
// Issue 128: which word the copy uses for the biometric, from the OS and expo-local-authentication's supported types
// (FINGERPRINT 1, FACIAL_RECOGNITION 2, IRIS 3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { biometricKind } from "./biometric-name.ts";

test("Android keeps fingerprint, whatever the phone reports", () => {
  assert.equal(biometricKind("android", [1]), "fingerprint");
  assert.equal(biometricKind("android", [2]), "fingerprint");
  assert.equal(biometricKind("android", []), "fingerprint");
});

test("an iPhone says Face ID or Touch ID, from what it supports", () => {
  assert.equal(biometricKind("ios", [2]), "faceId");
  assert.equal(biometricKind("ios", [1]), "touchId");
});

test("an iPhone that reports neither, or a failed read, gets the neutral words", () => {
  assert.equal(biometricKind("ios", []), "faceOrTouchId");
  assert.equal(biometricKind("ios", undefined), "faceOrTouchId");
});
