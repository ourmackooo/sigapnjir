// DSS SIGAP: skor prioritas 0..1 dan kontribusi tiap faktor agar keputusan bisa dijelaskan.
export const WEIGHTS = { severity: 0.35, affected: 0.25, vulnerable: 0.15, isolation: 0.15, time_pressure: 0.10 };

export const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

export function normalizeSeverity(waterCm, dangerCm) {
  const danger = Number(dangerCm);
  if (!Number.isFinite(danger) || danger <= 0) return 0;
  return clamp01(Number(waterCm) / danger);
}

export function normalizeAffected(affectedJiwa, population) {
  const pop = Number(population);
  if (!Number.isFinite(pop) || pop <= 0) return 0;
  return clamp01(Number(affectedJiwa) / pop);
}

export function normalizeVulnerable(impact = {}) {
  const jiwa = Number(impact.jiwa) || 0;
  const vulnerable = ["lansia", "anak", "disabilitas", "ibu_hamil"].reduce((sum, key) => sum + (Number(impact[key]) || 0), 0);
  if (jiwa > 0) return clamp01(vulnerable / jiwa);
  return 0;
}

export function normalizeIsolation({ aksesJalanTerputus = false, distanceToRsKm = null, shelterDistanceKm = null } = {}) {
  let score = aksesJalanTerputus ? 0.6 : 0;
  if (Number.isFinite(Number(distanceToRsKm))) score += clamp01(Number(distanceToRsKm) / 20) * 0.2;
  if (Number.isFinite(Number(shelterDistanceKm))) score += clamp01(Number(shelterDistanceKm) / 10) * 0.2;
  return clamp01(score);
}

// Tren 3 pembacaan terakhir: naik = 1, stabil = 0.3, turun = 0.
export function normalizeTimePressure(readings = []) {
  const values = readings.map(r => Number(r.water_cm)).filter(Number.isFinite).slice(-3);
  if (values.length < 2) return 0.3;
  const delta = values.at(-1) - values[0];
  if (delta > 0) return clamp01(0.5 + Math.min(delta, 100) / 200);
  if (delta < 0) return 0;
  return 0.3;
}

export function computePriority({ waterCm = 0, dangerCm = 0, affected = 0, population = 0, impact = {}, isolation = 0, timePressure = 0.3 } = {}) {
  const factors = {
    severity: normalizeSeverity(waterCm, dangerCm),
    affected: normalizeAffected(affected, population),
    vulnerable: normalizeVulnerable(impact),
    isolation: clamp01(isolation),
    time_pressure: clamp01(timePressure),
  };
  const contributions = Object.fromEntries(Object.entries(WEIGHTS).map(([key, weight]) => [key, Number((factors[key] * weight).toFixed(4))]));
  const score = Number(Object.values(contributions).reduce((sum, value) => sum + value, 0).toFixed(4));
  return { score, factors, contributions };
}

export function rankZone({ zone, aggregate, latestReading, readings, isolation }) {
  const result = computePriority({
    waterCm: latestReading?.water_cm ?? aggregate.ketinggian_air_cm ?? 0,
    dangerCm: latestReading?.danger_cm ?? 0,
    affected: aggregate.jiwa,
    population: zone.population,
    impact: aggregate,
    isolation: isolation ?? normalizeIsolation({ aksesJalanTerputus: aggregate.akses_jalan }),
    timePressure: normalizeTimePressure(readings),
  });
  return { zone_id: zone.id, zone_code: zone.code, zone_name: zone.name, ...result };
}
