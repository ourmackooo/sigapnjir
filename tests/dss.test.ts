import { describe, test, expect } from "bun:test";
import {
  WEIGHTS, clamp01, computePriority, normalizeAffected, normalizeIsolation,
  normalizeSeverity, normalizeTimePressure, normalizeVulnerable, rankZone,
} from "../src/shared/dss.js";

describe("normalisasi DSS", () => {
  test("nilai dinormalkan ke 0..1", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(normalizeSeverity(90, 180)).toBe(0.5);
    expect(normalizeSeverity(300, 180)).toBe(1);
    expect(normalizeAffected(50, 100)).toBe(0.5);
    expect(normalizeAffected(10, 0)).toBe(0);
    expect(normalizeVulnerable({ jiwa: 100, lansia: 10, anak: 20, disabilitas: 0, ibu_hamil: 0 })).toBe(0.3);
    expect(normalizeIsolation({ aksesJalanTerputus: true })).toBeGreaterThanOrEqual(0.6);
  });

  test("tren pembacaan: naik lebih mendesak daripada turun", () => {
    expect(normalizeTimePressure([{ water_cm: 100 }, { water_cm: 120 }, { water_cm: 150 }])).toBeGreaterThan(0.5);
    expect(normalizeTimePressure([{ water_cm: 150 }, { water_cm: 120 }, { water_cm: 100 }])).toBe(0);
    expect(normalizeTimePressure([])).toBe(0.3);
  });
});

describe("skor prioritas", () => {
  test("kontribusi dijumlahkan dengan bobot yang benar", () => {
    const result = computePriority({
      waterCm: 180, dangerCm: 180, affected: 500, population: 500,
      impact: { jiwa: 500, lansia: 200, anak: 300, disabilitas: 0, ibu_hamil: 0 },
      isolation: 1, timePressure: 1,
    });
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(result.score).toBeCloseTo(1, 4);
    expect(result.contributions.severity).toBeCloseTo(0.35, 4);
    expect(result.contributions.affected).toBeCloseTo(0.25, 4);
    expect(result.contributions.vulnerable).toBeCloseTo(0.15, 4);
    const sum = Object.values(result.contributions).reduce((a, b) => a + b, 0);
    expect(result.score).toBeCloseTo(sum, 4);
  });

  test("urutan skor mengikuti tingkat keparahan", () => {
    const zone = { id: "z1", code: "Z1", name: "Zona", population: 1000 };
    const high = rankZone({ zone, aggregate: { jiwa: 500, akses_jalan: true }, latestReading: { water_cm: 180, danger_cm: 180 }, readings: [{ water_cm: 100 }, { water_cm: 150 }, { water_cm: 180 }] });
    const low = rankZone({ zone, aggregate: { jiwa: 10, akses_jalan: false }, latestReading: { water_cm: 20, danger_cm: 180 }, readings: [{ water_cm: 40 }, { water_cm: 30 }, { water_cm: 20 }] });
    expect(high.score).toBeGreaterThan(low.score);
  });
});
