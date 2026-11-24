import { describe, test, expect, beforeAll } from "bun:test";
import { createApi } from "../src/server/api.js";
import { createDemoStore } from "../src/server/demo-store.js";

const store = createDemoStore();
const app = createApi({ demo: true, store });

async function request(path, { token, headers = {}, method = "GET", body } = {}) {
  const res = await app.handle(new Request(`http://localhost/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  }));
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

let admin, warga, petugas, bpbd, polresPic, event, zones, dinas;
beforeAll(async () => {
  admin = (await request("/auth/login", { method: "POST", body: { email: "admin@demo.test", password: "AdminDemo123!" } })).json.token;
  warga = (await request("/auth/login", { method: "POST", body: { email: "warga@demo.test", password: "WargaDemo123!" } })).json.token;
  petugas = (await request("/auth/login", { method: "POST", body: { email: "petugas@demo.test", password: "PetugasDemo123!" } })).json.token;
  bpbd = (await request("/auth/login", { method: "POST", body: { email: "bpbd@demo.test", password: "BpbdDemo123!" } })).json.token;
  polresPic = (await request("/auth/login", { method: "POST", body: { email: "polres@demo.test", password: "PicDemo123!" } })).json.token;
  expect(admin && warga && petugas && bpbd && polresPic).toBeTruthy();
  event = (await request("/events", { token: admin })).json.data[0];
  zones = (await request(`/events/${event.id}/zones`, { token: admin })).json.data;
  dinas = (await request("/dinas", { token: admin })).json.data;
});

describe("Sensor dan peringatan", () => {
  test("sensor melewati ambang membuat alert dan zona kritis", async () => {
    expect((await request("/sensors/SEN-01/readings", { method: "POST", body: { water_cm: 190 } })).status).toBe(401);
    const reading = await request("/sensors/SEN-01/readings", {
      method: "POST", headers: { "x-sensor-token": "demo-sensor-1" }, body: { water_cm: 190 },
    });
    expect(reading.status).toBe(201);
    expect(reading.json.status).toBe("bahaya");
    expect(reading.json.zone_status).toBe("kritis");
    const after = (await request(`/events/${event.id}/zones`, { token: admin })).json.data;
    expect(after.find(z => z.code === "Z-DESA-01").status).toBe("kritis");
  });

  test("token sensor salah dan angka negatif ditolak", async () => {
    expect((await request("/sensors/SEN-01/readings", { method: "POST", headers: { "x-sensor-token": "salah" }, body: { water_cm: 100 } })).status).toBe(401);
    expect((await request("/sensors/SEN-01/readings", { method: "POST", headers: { "x-sensor-token": "demo-sensor-1" }, body: { water_cm: -5 } })).status).toBe(400);
  });
});

describe("Verifikasi laporan", () => {
  test("verifikasi mengubah agregat zona dan menolak dampak negatif", async () => {
    const pending = (await request("/government/verification", { token: admin })).json.data;
    const report = pending.find(r => r.ticket_number === "LPK-EVENT0002");
    expect(report).toBeTruthy();
    expect((await request(`/government/reports/${report.id}/verification`, { token: admin, method: "PATCH", body: { verification_status: "verified", impact: { jiwa: -2 } } })).status).toBe(400);
    const verified = await request(`/government/reports/${report.id}/verification`, {
      token: admin, method: "PATCH", body: { verification_status: "verified", impact: { jiwa: 60 } },
    });
    expect(verified.status).toBe(200);
    expect(verified.json.report.verification_status).toBe("verified");
    const priority = (await request(`/events/${event.id}/priority`, { token: admin })).json.data;
    const wetan = priority.find(z => z.zone_code === "Z-DESA-02");
    expect(wetan.aggregate.jiwa).toBe(60);
  });

  test("laporan warga baru masuk antrean verifikasi", async () => {
    const out = await request("/submit-laporan", { token: warga, method: "POST", body: {
      description_raw: "Air mulai masuk rumah\nLokasi: RT 05 Desa Banjir Kidul\n\nWarga butuh bantuan.", lat: -7.985, lng: 112.625,
      event_id: event.id, zone_id: zones.find(z => z.code === "Z-DESA-01").id,
      impact: { kk: 3, jiwa: 12, ketinggian_air_cm: 60 },
    } });
    expect(out.status).toBe(201);
    const pending = (await request(`/government/verification?event_id=${event.id}`, { token: admin })).json.data;
    expect(pending.some(r => r.id === out.json.report.id)).toBe(true);
  });

  test("laporan dengan dampak negatif ditolak saat dibuat", async () => {
    const out = await request("/submit-laporan", { token: warga, method: "POST", body: {
      description_raw: "Laporan uji dampak negatif\nLokasi: Desa Banjir Kidul\n\nAir naik.", lat: -7.98, lng: 112.63,
      event_id: event.id, zone_id: zones[0].id, impact: { jiwa: -1 },
    } });
    expect(out.status).toBe(400);
  });
});

describe("Isolasi akses organisasi", () => {
  test("task organisasi lain tidak terlihat", async () => {
    const polres = dinas.find(d => d.slug === "polres");
    const created = await request(`/events/${event.id}/tasks`, { token: admin, method: "POST", body: { dinas_id: polres.id, title: "Amankan jalur evakuasi" } });
    expect(created.status).toBe(201);
    const mine = (await request(`/events/${event.id}/tasks`, { token: petugas })).json.data;
    expect(mine.some(t => t.title === "Amankan jalur evakuasi")).toBe(false);
    const all = (await request(`/events/${event.id}/tasks`, { token: admin })).json.data;
    expect(all.some(t => t.title === "Amankan jalur evakuasi")).toBe(true);
    const other = (await request(`/events/${event.id}/tasks`, { token: bpbd })).json.data;
    expect(other.some(t => t.title === "Amankan jalur evakuasi")).toBe(false);
  });
});

describe("Role PIC dan BPBD", () => {
  test("BPBD pusat koordinasi; PIC hanya mengelola instansinya", async () => {
    expect((await request("/events", { token: polresPic, method: "POST", body: { name: "Event oleh PIC" } })).status).toBe(403);
    const picList = (await request("/government/pic", { token: admin })).json.data;
    const polres = picList.find(d => d.slug === "polres");
    expect(polres.pic_email).toBe("polres@demo.test");
    expect((await request(`/government/dinas/${polres.id}/pic`, { token: polresPic, method: "POST", body: { email: "polres@demo.test" } })).status).toBe(403);
    expect((await request(`/government/dinas/${polres.id}/pic`, { token: admin, method: "POST", body: { email: "polres@demo.test" } })).status).toBe(200);
    const task = await request(`/events/${event.id}/tasks`, { token: admin, method: "POST", body: { dinas_id: polres.id, title: "Koordinasi dapur umum" } });
    expect(task.status).toBe(201);
    expect((await request(`/tasks/${task.json.task.id}`, { token: polresPic, method: "PATCH", body: { status: "in_progress" } })).status).toBe(200);
    expect((await request(`/tasks/${task.json.task.id}`, { token: petugas, method: "PATCH", body: { status: "done" } })).status).toBe(403);
  });
});

describe("DSS dan override", () => {
  test("skor prioritas punya kontribusi faktor dan override tercatat", async () => {
    const ranked = (await request(`/events/${event.id}/priority`, { token: admin })).json.data;
    expect(ranked.length).toBeGreaterThan(0);
    for (const row of ranked) {
      expect(row.score).toBeGreaterThanOrEqual(0);
      expect(row.score).toBeLessThanOrEqual(1);
      expect(Object.keys(row.contributions).sort()).toEqual(["affected", "isolation", "severity", "time_pressure", "vulnerable"]);
    }
    const zone = ranked[0];
    expect((await request(`/events/${event.id}/priority/${zone.zone_id}/override`, { token: admin, method: "POST", body: { reason: "x" } })).status).toBe(400);
    const out = await request(`/events/${event.id}/priority/${zone.zone_id}/override`, { token: admin, method: "POST", body: { score: 0.99, reason: "Akses jalan utama putus total, evakuasi udara belum tersedia." } });
    expect(out.status).toBe(200);
    const refreshed = (await request(`/events/${event.id}/priority`, { token: admin })).json.data;
    expect(refreshed[0].override.reason).toContain("Akses jalan utama");
    expect(refreshed[0].final_score).toBe(0.99);
  });
});

describe("Logistik", () => {
  test("alokasi tidak boleh melebihi permintaan dan penerimaan tidak melebihi alokasi", async () => {
    const list = (await request(`/logistics?event_id=${event.id}`, { token: admin })).json.data;
    const row = list[0];
    expect((await request(`/logistics/${row.id}`, { token: admin, method: "PATCH", body: { qty_allocated: row.qty_requested + 1 } })).status).toBe(400);
    expect((await request(`/logistics/${row.id}`, { token: admin, method: "PATCH", body: { qty_allocated: 100, qty_received: 101 } })).status).toBe(400);
    const ok = await request(`/logistics/${row.id}`, { token: admin, method: "PATCH", body: { qty_allocated: 100, qty_received: 100 } });
    expect(ok.status).toBe(200);
    expect(ok.json.request.status).toBe("delivered");
  });
});

describe("Endpoint pendukung UI", () => {
  test("zona, sensor, shelter, laporan event, dan notifikasi dapat dibaca", async () => {
    expect((await request("/event-zones", { token: admin })).json.data.length).toBe(3);
    expect((await request("/sensors", { token: admin })).json.data[0]).not.toHaveProperty("token_hash");
    expect((await request("/shelters", { token: admin })).json.data.length).toBeGreaterThan(0);
    expect((await request(`/events/${event.id}/reports`, { token: admin })).json.data.length).toBeGreaterThan(0);
    expect(Array.isArray((await request("/public/events")).json.data)).toBe(true);
    expect(Array.isArray((await request("/notifications", { token: bpbd })).json.data)).toBe(true);
  });
});

describe("Halaman peringatan publik", () => {
  test("tanpa PII dan menampilkan agregat zona", async () => {
    const res = await request(`/events/${event.id}/alert`);
    expect(res.status).toBe(200);
    expect(res.json.event.name).toContain("Banjir");
    expect(JSON.stringify(res.json)).not.toContain("user_id");
    expect(res.json.zones[0].aggregate).toBeTruthy();
  });
});
