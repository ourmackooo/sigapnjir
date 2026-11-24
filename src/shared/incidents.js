const NUMERIC_FIELDS = ["kk", "jiwa", "korban_meninggal", "lansia", "anak", "disabilitas", "ibu_hamil", "ketinggian_air_cm"];
const INT_FIELDS = new Set(NUMERIC_FIELDS);
const ALLOWED = new Set([...NUMERIC_FIELDS, "akses_jalan", "kebutuhan"]);

export function normalizeImpact(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const impact = {};
  for (const field of NUMERIC_FIELDS) impact[field] = Number.isFinite(Number(source[field])) ? Math.max(0, Math.trunc(Number(source[field]))) : 0;
  impact.akses_jalan = source.akses_jalan === true || source.akses_jalan === "terputus";
  impact.kebutuhan = Array.isArray(source.kebutuhan)
    ? [...new Set(source.kebutuhan.map(String).map(s => s.trim()).filter(Boolean))].slice(0, 20)
    : [];
  return impact;
}

// Dipakai di API & seed. Menolak angka negatif dan tipe yang tidak masuk akal.
export function validateImpact(input) {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object" || Array.isArray(input)) return "Data dampak harus berupa objek.";
  for (const key of Object.keys(input)) if (!ALLOWED.has(key)) return `Kolom dampak tidak dikenal: ${key}.`;
  for (const field of NUMERIC_FIELDS) {
    if (input[field] === undefined || input[field] === null || input[field] === "") continue;
    const value = Number(input[field]);
    if (!Number.isFinite(value)) return `Dampak ${field} harus berupa angka.`;
    if (value < 0) return `Dampak ${field} tidak boleh negatif.`;
    if (INT_FIELDS.has(field) && !Number.isInteger(value)) return `Dampak ${field} harus bilangan bulat.`;
  }
  if (input.akses_jalan !== undefined && typeof input.akses_jalan !== "boolean" && input.akses_jalan !== "terputus" && input.akses_jalan !== "terbuka") {
    return "Akses jalan harus berupa boolean.";
  }
  if (input.kebutuhan !== undefined) {
    if (!Array.isArray(input.kebutuhan) || input.kebutuhan.some(k => typeof k !== "string")) return "Kebutuhan harus berupa daftar teks.";
    if (input.kebutuhan.length > 20) return "Kebutuhan maksimal 20 item.";
  }
  return null;
}

// Agregasi zona: laporan terverifikasi saja. Laporan duplikat/ditolak tidak dihitung.
export function aggregateImpact(reports = []) {
  const verified = reports.filter(r => r.verification_status === "verified");
  const total = normalizeImpact({});
  for (const report of verified) {
    const impact = normalizeImpact(report.impact);
    for (const field of NUMERIC_FIELDS) {
      total[field] += field === "ketinggian_air_cm" ? 0 : impact[field];
    }
    total.ketinggian_air_cm = Math.max(total.ketinggian_air_cm, impact.ketinggian_air_cm);
    total.akses_jalan ||= impact.akses_jalan;
    total.kebutuhan = [...new Set([...total.kebutuhan, ...impact.kebutuhan])];
  }
  return { ...total, laporan: verified.length };
}

export function readingStatus(waterCm, warnCm, dangerCm) {
  if (!Number.isFinite(Number(waterCm))) return "normal";
  if (Number(waterCm) >= Number(dangerCm)) return "bahaya";
  if (Number(waterCm) >= Number(warnCm)) return "waspada";
  return "normal";
}

export function zoneStatusForReading(status) {
  return status === "bahaya" ? "kritis" : status === "waspada" ? "terdampak" : null;
}
