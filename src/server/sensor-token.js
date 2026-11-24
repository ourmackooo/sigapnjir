import { createHash, timingSafeEqual } from "node:crypto";

export function hashSensorToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function verifySensorToken(token, expectedHash) {
  if (!token || !expectedHash) return false;
  const actual = Buffer.from(hashSensorToken(token), "hex");
  const expected = Buffer.from(String(expectedHash), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
