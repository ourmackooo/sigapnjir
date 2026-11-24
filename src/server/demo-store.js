import { randomUUID } from "node:crypto";
import { hashPassword } from "./auth.js";
import { hashSensorToken } from "./sensor-token.js";

export function createDemoStore() {
  const dinas = [
    { id: randomUUID(), slug: "pu", name: "Dinas Pekerjaan Umum", kind: "dinas" },
    { id: randomUUID(), slug: "lingkungan", name: "Dinas Lingkungan Hidup", kind: "dinas" },
    { id: randomUUID(), slug: "perhubungan", name: "Dinas Perhubungan", kind: "dinas" },
    { id: randomUUID(), slug: "bpbd", name: "BPBD Kabupaten Sejahtera", kind: "bpbd" },
    { id: randomUUID(), slug: "polres", name: "Polres Kabupaten Sejahtera", kind: "polres" },
    { id: randomUUID(), slug: "rsud", name: "RSUD Kabupaten Sejahtera", kind: "rs" },
    { id: randomUUID(), slug: "pmi", name: "PMI Kabupaten Sejahtera", kind: "relawan" },
  ];
  const users = [
    { id: randomUUID(), email: "warga@demo.test", password_hash: hashPassword("WargaDemo123!"), role: "user", full_name: "Warga Demo", is_active: true },
    { id: randomUUID(), email: "admin@demo.test", password_hash: hashPassword("AdminDemo123!"), role: "admin", full_name: "Koordinator BPBD", is_active: true },
    { id: randomUUID(), email: "petugas@demo.test", password_hash: hashPassword("PetugasDemo123!"), role: "pemerintah", dinas_id: dinas[0].id, full_name: "PIC Dinas PU", is_active: true },
    { id: randomUUID(), email: "bpbd@demo.test", password_hash: hashPassword("BpbdDemo123!"), role: "pemerintah", dinas_id: dinas[3].id, full_name: "PIC BPBD", is_active: true },
    { id: randomUUID(), email: "polres@demo.test", password_hash: hashPassword("PicDemo123!"), role: "pemerintah", dinas_id: dinas[4].id, full_name: "PIC Polres", is_active: true },
    { id: randomUUID(), email: "rsud@demo.test", password_hash: hashPassword("PicDemo123!"), role: "pemerintah", dinas_id: dinas[5].id, full_name: "PIC RSUD", is_active: true },
    { id: randomUUID(), email: "pmi@demo.test", password_hash: hashPassword("PicDemo123!"), role: "pemerintah", dinas_id: dinas[6].id, full_name: "PIC PMI", is_active: true },
  ];
  dinas[0].pic_user_id = users[2].id;
  dinas[3].pic_user_id = users[3].id;
  dinas[4].pic_user_id = users[4].id;
  dinas[5].pic_user_id = users[5].id;
  dinas[6].pic_user_id = users[6].id;
  const sessions = new Map();
  const reports = new Map();
  const histories = new Map();
  const feedbacks = new Map();
  const reroutes = new Map();
  const faq = new Map();
  const zones = [];
  const events = [];
  const eventZones = [];
  const sensors = [];
  const readings = [];
  const shelters = [];
  const participants = [];
  const tasks = [];
  const overrides = [];
  const logistics = [];
  const notifications = [];
  const examples = [
    ["LPK-DEMO0001", "Jalan berlubang di Soekarno Hatta", "Lowokwaru, Kota Malang", "Lubang di badan jalan membahayakan pengendara saat hujan.", "in_progress", 45, 0],
    ["LPK-DEMO0002", "Sampah menumpuk di sekitar TPS", "Klojen, Kota Malang", "Pengangkutan sampah perlu ditingkatkan agar akses warga kembali bersih.", "resolved", 100, 1],
    ["LPK-DEMO0003", "Lampu jalan tidak menyala", "Blimbing, Kota Malang", "Lampu penerangan padam sehingga pengguna jalan kesulitan pada malam hari.", "accepted", 15, 2],
    ["LPK-DEMO0004", "Masukan untuk jadwal layanan warga", "Kantor layanan kecamatan", "Usulan agar jadwal pelayanan dipublikasikan lebih jelas.", "submitted", 0, null],
  ];
  examples.forEach(([ticket, title, location, description, status, progress, dinasIndex], index) => {
    const id = randomUUID();
    const date = new Date(Date.now() - (4 - index) * 86400000).toISOString();
    reports.set(id, {
      id, ticket_number: ticket, user_id: users[0].id,
      description_raw: `${title}\nLokasi: ${location}\n\n${description}`,
      image_url: null, status, progress_percent: progress,
      dinas_id: dinasIndex === null ? null : dinas[dinasIndex].id,
      is_public: index < 3, moderation_status: index < 3 ? "published" : "pending",
      public_title: title, public_location: location, description_redacted: description,
      urgency: "sedang", submitted_at: date, updated_at: date,
    });
    histories.set(id, [{ id: randomUUID(), to_status: "submitted", note: "Laporan diterima oleh sistem.", progress_percent: 0, created_at: date }]);
    if (status !== "submitted") histories.get(id).push({ id: randomUUID(), to_status: status, note: status === "resolved" ? "Penanganan selesai dan sudah diperiksa petugas." : "Petugas sudah memeriksa laporan dan menyiapkan penanganan.", progress_percent: progress, created_at: new Date().toISOString() });
  });

  // Seed SIGAP: satu event banjir, tiga zona, dua sensor, satu shelter.
  const zonaIds = {
    kec: randomUUID(), kidul: randomUUID(), wetan: randomUUID(),
  };
  zones.push(
    { id: zonaIds.kec, code: "Z-KEC-01", name: "Kecamatan Sejahtera", level: "kecamatan", parent_id: null, lat: -7.98, lng: 112.63, population: 42000, vulnerable_population: 5200 },
    { id: zonaIds.kidul, code: "Z-DESA-01", name: "Desa Banjir Kidul", level: "desa", parent_id: zonaIds.kec, lat: -7.985, lng: 112.625, population: 8600, vulnerable_population: 1500 },
    { id: zonaIds.wetan, code: "Z-DESA-02", name: "Desa Tanggul Wetan", level: "desa", parent_id: zonaIds.kec, lat: -7.975, lng: 112.638, population: 6400, vulnerable_population: 980 },
  );
  const event = { id: randomUUID(), code: "EV-2026-001", name: "Banjir Sungai Sejahtera", type: "banjir", status: "tanggap_darurat", started_at: new Date(Date.now() - 6 * 3600000).toISOString(), ended_at: null, commander_id: users[3].id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  events.push(event);
  eventZones.push(
    { event_id: event.id, zone_id: zonaIds.kidul, status: "kritis", source: "sensor", first_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { event_id: event.id, zone_id: zonaIds.wetan, status: "waspada", source: "sensor", first_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  );
  const sensor1 = { id: randomUUID(), code: "SEN-01", name: "Sensor Banjir Kidul", zone_id: zonaIds.kidul, lat: -7.985, lng: 112.625, warn_cm: 120, danger_cm: 180, token_hash: hashSensorToken("demo-sensor-1"), is_active: true, last_seen_at: null };
  const sensor2 = { id: randomUUID(), code: "SEN-02", name: "Sensor Tanggul Wetan", zone_id: zonaIds.wetan, lat: -7.975, lng: 112.638, warn_cm: 100, danger_cm: 150, token_hash: hashSensorToken("demo-sensor-2"), is_active: true, last_seen_at: null };
  sensors.push(sensor1, sensor2);
  const now = Date.now();
  for (const [sensor, values] of [[sensor1, [135, 160, 185]], [sensor2, [95, 110, 125]]]) {
    values.forEach((water_cm, index) => readings.push({ id: randomUUID(), sensor_id: sensor.id, water_cm, recorded_at: new Date(now - (2 - index) * 600000).toISOString(), received_at: new Date(now - (2 - index) * 600000).toISOString(), status: water_cm >= sensor.danger_cm ? "bahaya" : water_cm >= sensor.warn_cm ? "waspada" : "normal" }));
  }
  const shelter = { id: randomUUID(), zone_id: zonaIds.kidul, name: "Balai Desa Banjir Kidul", lat: -7.986, lng: 112.626, capacity: 300, occupancy: 120, status: "aktif", contact: "081234567890", needs: ["selimut", "air bersih", "makanan"], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  shelters.push(shelter);
  for (const [dinasIndex, role] of [[3, "komando"], [4, "keamanan"], [5, "kesehatan"], [6, "relawan"]]) {
    participants.push({ id: randomUUID(), event_id: event.id, dinas_id: dinas[dinasIndex].id, role, created_at: new Date().toISOString() });
  }
  tasks.push({ id: randomUUID(), event_id: event.id, dinas_id: dinas[4].id, title: "Evakuasi warga Desa Banjir Kidul", description: "Prioritaskan lansia dan anak-anak di RT 03.", status: "open", assigned_to: null, due_at: null, created_by: users[1].id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  logistics.push({ id: randomUUID(), event_id: event.id, shelter_id: shelter.id, item: "selimut", qty_requested: 200, qty_allocated: 80, qty_received: 0, status: "allocated", requested_by: users[3].id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  for (const [ticket, title, location, impact, verification] of [
    ["LPK-EVENT0001", "Air masuk rumah warga", "RT 03 Desa Banjir Kidul", { kk: 42, jiwa: 168, korban_meninggal: 0, lansia: 18, anak: 34, disabilitas: 3, ibu_hamil: 4, ketinggian_air_cm: 140, akses_jalan: true, kebutuhan: ["evakuasi", "selimut", "air bersih"] }, "verified"],
    ["LPK-EVENT0002", "Jalan desa terputus", "Desa Tanggul Wetan", { kk: 12, jiwa: 45, korban_meninggal: 0, lansia: 5, anak: 9, disabilitas: 0, ibu_hamil: 1, ketinggian_air_cm: 90, akses_jalan: true, kebutuhan: ["perahu karet"] }, "unverified"],
  ]) {
    const id = randomUUID();
    const zoneId = ticket === "LPK-EVENT0001" ? zonaIds.kidul : zonaIds.wetan;
    reports.set(id, { id, ticket_number: ticket, user_id: users[0].id, description_raw: `${title}\nLokasi: ${location}\n\n${title}.`, image_url: null, status: "submitted", progress_percent: 0, dinas_id: null, is_public: false, moderation_status: "pending", public_title: title, public_location: location, description_redacted: title, urgency: "darurat", submitted_at: new Date().toISOString(), updated_at: new Date().toISOString(), event_id: event.id, zone_id: zoneId, impact, verification_status: verification, verified_by: verification === "verified" ? users[1].id : null, verified_at: verification === "verified" ? new Date().toISOString() : null, source: "warga", lat: zoneId === zonaIds.kidul ? -7.985 : -7.975, lng: zoneId === zonaIds.kidul ? 112.625 : 112.638, address: location });
    histories.set(id, [{ id: randomUUID(), to_status: "submitted", note: "Laporan diterima oleh sistem.", progress_percent: 0, created_at: new Date().toISOString() }]);
  }
  const addFeedbackSync = (reportId, user, message, at) => {
    if (!feedbacks.has(reportId)) feedbacks.set(reportId, []);
    feedbacks.get(reportId).push({ id: randomUUID(), sender_id: user.id, message, sender_name: user.full_name ?? null, sender_role: user.role, created_at: at });
  };
  const decorate = (row) => row && { ...row, dinas_name: dinas.find(d => d.id === row.dinas_id)?.name ?? null, pending_routing: pendingOf(row.id) };
  const pendingOf = (id) => {
    const r = reroutes.get(id);
    if (!r || r.status !== "pending") return null;
    const target = dinas.find(d => d.id === r.requested_dinas_id);
    return { id: r.request_id, requested_dinas_id: r.requested_dinas_id, requested_dinas_name: target?.name ?? null,
      requested_by: r.requested_by, previous_status: r.previous_status, note: r.note, created_at: r.created_at };
  };
  return {
    async userByEmail(email) { return users.find(u => u.email === email); },
    async register(email, password_hash, full_name) {
      if (users.some(u => u.email === email)) throw Object.assign(new Error("duplicate"), { code: "23505" });
      const row = { id: randomUUID(), email, password_hash, full_name, role: "user", is_active: true };
      users.push(row); return row;
    },
    async session(token) { const s = sessions.get(token); return s && s.expires > Date.now() ? users.find(u => u.id === s.user_id && u.is_active) : null; },
    async login(token, user_id) { sessions.set(token, { user_id, expires: Date.now() + 7 * 86400000 }); },
    async logout(token) { sessions.delete(token); },
    async createReport(input) {
      const row = { ...input, id: randomUUID(), status: "submitted", progress_percent: 0, moderation_status: "pending", dinas_id: null, submitted_at: new Date().toISOString(), verification_status: "unverified", source: input.source ?? "warga", impact: input.impact ?? {} };
      reports.set(row.id, row);
      histories.set(row.id, [{ id: randomUUID(), to_status: "submitted", note: "Laporan diterima oleh sistem.", progress_percent: 0, created_at: row.submitted_at }]);
      return decorate(row);
    },
    async list() { return [...reports.values()].map(decorate).sort((a,b) => b.submitted_at.localeCompare(a.submitted_at)); },
    async get(id) { return decorate(reports.get(id)); },
    async ticket(ticket) { return decorate([...reports.values()].find(r => r.ticket_number === ticket)); },
    async history(id) { return histories.get(id) ?? []; },
    async feedbacks(reportId, userId) {
      return (feedbacks.get(reportId) ?? []).map(f => ({ ...f, mine: f.sender_id === userId }));
    },
    async addFeedback(reportId, user, message) {
      const row = { id: randomUUID(), sender_id: user.id, message, sender_name: user.full_name ?? null, sender_role: user.role, created_at: new Date().toISOString() };
      if (!feedbacks.has(reportId)) feedbacks.set(reportId, []);
      feedbacks.get(reportId).push(row);
      return row;
    },
    async dinas() {
      return dinas.map(d => {
        const pic = users.find(u => u.id === d.pic_user_id);
        return { ...d, pic_name: pic?.full_name ?? null, pic_email: pic?.email ?? null };
      });
    },
    async setPic(dinasId, userId) {
      const row = dinas.find(d => d.id === dinasId);
      if (!row) return undefined;
      row.pic_user_id = userId;
      return row;
    },
    async askFaqQuestion(userId, question) {
      const row = { id: randomUUID(), user_id: userId, question, answer: null, answered_by: null, answered_at: null, status: "open", created_at: new Date().toISOString() };
      if (!faq.has(userId)) faq.set(userId, []);
      faq.get(userId).push(row);
      return row;
    },
    async faqQuestionsByUser(userId) { return faq.get(userId) ?? []; },
    async faqQuestions(status) {
      const all = [...faq.values()].flat();
      const rows = all.map(q => ({ ...q, user_name: users.find(u => u.id === q.user_id)?.full_name ?? null }));
      return status ? rows.filter(q => q.status === status) : rows;
    },
    async answerFaqQuestion(id, adminId, answer) {
      for (const list of faq.values()) {
        const q = list.find(x => x.id === id);
        if (q) { q.answer = answer; q.answered_by = adminId; q.answered_at = new Date().toISOString(); q.status = "answered"; return q; }
      }
      return null;
    },
    async pendingRoutingRequest(reportId) { return pendingOf(reportId); },
    async requestReroute(reportId, user, dinasId, note) {
      const row = reports.get(reportId);
      if (!row) return null;
      const existing = reroutes.get(reportId);
      if (existing?.status === "pending") return { error: "already_pending" };
      const target = dinas.find(d => d.id === dinasId);
      if (!target) return { error: "invalid_dinas" };
      const at = new Date().toISOString();
      const requestId = randomUUID();
      reroutes.set(reportId, { request_id: requestId, requested_dinas_id: dinasId, requested_by: user.id, previous_status: row.status, note, status: "pending", created_at: at });
      const fromStatus = row.status;
      row.status = "needs_review"; row.updated_at = at;
      const message = note ? `Permintaan perutean ke ${target.name}. ${note}` : `Meminta perutean ke ${target.name}.`;
      histories.get(reportId).push({ id: randomUUID(), from_status: fromStatus, to_status: "needs_review", actor_id: user.id, actor_type: "user", note: message, progress_percent: 0, created_at: at });
      addFeedbackSync(reportId, user, message, at);
      return { ok: true };
    },
    async decideReroute(reportId, requestId, admin, decision, note) {
      const r = reroutes.get(reportId);
      if (!r || r.request_id !== requestId || r.status !== "pending") return { error: "no_pending" };
      const row = reports.get(reportId);
      if (!row) return { error: "not_found" };
      const target = dinas.find(d => d.id === r.requested_dinas_id);
      const fromStatus = row.status;
      const at = new Date().toISOString();
      const message = note ? `${decision === "approve" ? "Perutean ke " : "Permintaan perutean ke "}${target?.name ?? "dinas tujuan"} ${decision === "approve" ? "disetujui admin." : "ditolak admin."} ${note}` : `${decision === "approve" ? "Perutean ke " : "Permintaan perutean ke "}${target?.name ?? "dinas tujuan"} ${decision === "approve" ? "disetujui admin." : "ditolak admin."}`;
      if (decision === "approve") {
        r.status = "approved"; row.dinas_id = r.requested_dinas_id; row.status = "routed"; row.routed_at = at;
      } else {
        r.status = "rejected"; row.status = r.previous_status;
      }
      row.updated_at = at;
      histories.get(reportId).push({ id: randomUUID(), from_status: fromStatus, to_status: row.status, actor_id: admin.id, actor_type: "admin", note: message, progress_percent: row.progress_percent ?? 0, created_at: at });
      addFeedbackSync(reportId, admin, message, at);
      return { report: decorate(row), previousStatus: r.previous_status };
    },
    async assignDinas(id, dinasId, adminId) {
      const row = reports.get(id);
      if (!row) return null;
      const newStatus = row.status === "needs_review" && dinasId ? "routed" : row.status;
      row.dinas_id = dinasId; row.status = newStatus;
      const at = new Date().toISOString();
      histories.get(id).push({ id: randomUUID(), from_status: row.status, to_status: newStatus, actor_id: adminId, actor_type: "admin", note: "Admin menetapkan dinas tujuan; laporan dirutekan.", progress_percent: 0, created_at: at });
      return decorate(row);
    },
    async update(id, input, actor, expected) {
      const row = reports.get(id);
      if (!row || (row.updated_at ?? row.submitted_at) !== expected) return null;
      const event = { id: randomUUID(), from_status: row.status, to_status: input.status, note: input.note, progress_percent: input.progress_percent, created_at: new Date(Math.max(Date.now(), Date.parse(row.updated_at ?? row.submitted_at) + 1)).toISOString() };
      const resolved = input.status === "resolved";
      Object.assign(row, input, { updated_at: event.created_at,
        resolved_at: resolved ? event.created_at : null,
        resolution_requested_at: resolved ? event.created_at : null,
        resolution_request_note: resolved ? input.note : null });
      histories.get(id).push(event);
      return decorate(row);
    },
    async respondResolution(id, action, userId) {
      const row = reports.get(id);
      if (!row || row.user_id !== userId) return null;
      if (!row.resolution_requested_at) return { error: "no_request" };
      const at = new Date().toISOString();
      if (action === "approve") {
        row.resolution_requested_at = null; row.resolution_request_note = null; row.updated_at = at;
        histories.get(id).push({ id: randomUUID(), from_status: "resolved", to_status: "resolved", note: "Pelapor menyetujui status selesai.", progress_percent: 100, created_at: at });
        return { report: decorate(row) };
      }
      if (action !== "reject") return { error: "invalid_action" };
      const prev = (histories.get(id) ?? []).filter(h => h.progress_percent < 100).at(-1);
      const progress = prev ? prev.progress_percent : 0;
      Object.assign(row, { status: "in_progress", progress_percent: progress, resolved_at: null,
        resolution_requested_at: null, resolution_request_note: null, updated_at: at });
      histories.get(id).push({ id: randomUUID(), from_status: "resolved", to_status: "in_progress", note: "Pelapor menolak status selesai; laporan dikembalikan untuk ditangani kembali.", progress_percent: progress, created_at: at });
      return { report: decorate(row) };
    },

    // --- SIGAP incidents ---
    async listEvents() {
      return events.map(e => ({ ...e, commander_name: users.find(u => u.id === e.commander_id)?.full_name ?? null }))
        .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
    },
    async createEvent(input) {
      const row = { ...input, id: randomUUID(), status: input.status ?? "siaga", started_at: input.started_at ?? new Date().toISOString(), ended_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      events.push(row); return row;
    },
    async getEvent(id) { return events.find(e => e.id === id); },
    async updateEvent(id, patch) {
      const row = events.find(e => e.id === id);
      if (!row) return undefined;
      for (const key of ["name", "type", "status", "started_at", "ended_at", "commander_id"]) if (patch[key] !== undefined) row[key] = patch[key];
      row.updated_at = new Date().toISOString();
      return row;
    },
    async activeEvent() { return events.find(e => ["siaga", "tanggap_darurat"].includes(e.status)); },
    async listZones() { return zones; },
    async eventZones(eventId) {
      return eventZones.filter(ez => ez.event_id === eventId)
        .map(ez => ({ ...ez, ...zones.find(z => z.id === ez.zone_id) }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    },
    async upsertEventZone(eventId, zoneId, patch) {
      let row = eventZones.find(ez => ez.event_id === eventId && ez.zone_id === zoneId);
      if (!row) {
        row = { event_id: eventId, zone_id: zoneId, first_seen_at: new Date().toISOString() };
        eventZones.push(row);
      }
      row.status = patch.status ?? row.status ?? "waspada";
      row.source = patch.source ?? row.source ?? "manual";
      row.updated_at = new Date().toISOString();
      return row;
    },
    async reportsForEvent(eventId) {
      return [...reports.values()].filter(r => r.event_id === eventId).map(decorate).sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
    },
    async pendingReports(eventId) {
      return [...reports.values()].filter(r => r.event_id && r.verification_status === "unverified" && (!eventId || r.event_id === eventId))
        .map(decorate).sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)));
    },
    async verifyReport(id, input) {
      const row = reports.get(id);
      if (!row) return undefined;
      Object.assign(row, {
        verification_status: input.verification_status,
        impact: input.impact,
        zone_id: input.zone_id ?? null,
        verified_by: input.verified_by ?? null,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return row;
    },
    async listSensors() {
      return sensors.map(s => ({ ...s, zone_name: zones.find(z => z.id === s.zone_id)?.name ?? null }));
    },
    async sensorByCode(code) { return sensors.find(s => s.code === code); },
    async createSensor(input) {
      const row = { ...input, id: randomUUID(), is_active: true, last_seen_at: null, created_at: new Date().toISOString() };
      sensors.push(row); return row;
    },
    async touchSensor(id) {
      const row = sensors.find(s => s.id === id);
      if (row) row.last_seen_at = new Date().toISOString();
    },
    async addReading(input) {
      if (readings.some(r => r.sensor_id === input.sensor_id && r.recorded_at === input.recorded_at)) return undefined;
      const row = { ...input, id: randomUUID(), received_at: new Date().toISOString() };
      readings.push(row); return row;
    },
    async recentReadingsForSensor(sensorId, limit = 3) {
      return readings.filter(r => r.sensor_id === sensorId).sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at))).slice(0, limit);
    },
    async eventParticipants(eventId) {
      return participants.filter(p => p.event_id === eventId).map(p => {
        const d = dinas.find(x => x.id === p.dinas_id);
        const pic = users.find(u => u.id === d?.pic_user_id);
        return { ...p, dinas_name: d?.name ?? null, dinas_kind: d?.kind ?? null, pic_name: pic?.full_name ?? null, pic_email: pic?.email ?? null };
      });
    },
    async addParticipant(eventId, dinasId, role) {
      let row = participants.find(p => p.event_id === eventId && p.dinas_id === dinasId);
      if (row) { row.role = role; return row; }
      row = { id: randomUUID(), event_id: eventId, dinas_id: dinasId, role, created_at: new Date().toISOString() };
      participants.push(row); return row;
    },
    async getTask(id) {
      const row = tasks.find(t => t.id === id);
      return row && { ...row, dinas_name: dinas.find(d => d.id === row.dinas_id)?.name ?? null };
    },
    async tasksForEvent(eventId, dinasId) {
      return tasks.filter(t => t.event_id === eventId && (!dinasId || t.dinas_id === dinasId))
        .map(t => ({ ...t, dinas_name: dinas.find(d => d.id === t.dinas_id)?.name ?? null }))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    },
    async createTask(input) {
      const row = { ...input, id: randomUUID(), status: input.status ?? "open", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      tasks.push(row); return row;
    },
    async updateTask(id, patch) {
      const row = tasks.find(t => t.id === id);
      if (!row) return undefined;
      for (const key of ["title", "description", "status", "assigned_to", "due_at", "dinas_id"]) if (patch[key] !== undefined) row[key] = patch[key];
      row.updated_at = new Date().toISOString();
      return row;
    },
    async shelters(zoneId) { return zoneId ? shelters.filter(s => s.zone_id === zoneId) : shelters; },
    async createShelter(input) {
      const row = { ...input, id: randomUUID(), status: input.status ?? "aktif", occupancy: input.occupancy ?? 0, capacity: input.capacity ?? 0, needs: input.needs ?? [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      shelters.push(row); return row;
    },
    async updateShelter(id, patch) {
      const row = shelters.find(s => s.id === id);
      if (!row) return undefined;
      for (const key of ["name", "capacity", "occupancy", "status", "contact", "needs"]) if (patch[key] !== undefined) row[key] = patch[key];
      row.updated_at = new Date().toISOString();
      return row;
    },
    async priorityOverrides(eventId) { return overrides.filter(o => o.event_id === eventId); },
    async upsertPriorityOverride(input) {
      let row = overrides.find(o => o.event_id === input.event_id && o.zone_id === input.zone_id);
      if (row) Object.assign(row, { score: input.score, reason: input.reason, actor_id: input.actor_id, created_at: new Date().toISOString() });
      else { row = { ...input, id: randomUUID(), created_at: new Date().toISOString() }; overrides.push(row); }
      return row;
    },
    async logisticsForEvent(eventId) {
      return logistics.filter(l => l.event_id === eventId)
        .map(l => ({ ...l, shelter_name: shelters.find(s => s.id === l.shelter_id)?.name ?? null }))
        .sort((a, b) => String(a.shelter_name).localeCompare(String(b.shelter_name)) || String(a.item).localeCompare(String(b.item)));
    },
    async createLogistics(input) {
      const row = { ...input, id: randomUUID(), qty_allocated: 0, qty_received: 0, status: "requested", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      logistics.push(row); return row;
    },
    async updateLogistics(id, patch) {
      const row = logistics.find(l => l.id === id);
      if (!row) return undefined;
      for (const key of ["qty_allocated", "qty_received", "status"]) if (patch[key] !== undefined) row[key] = patch[key];
      row.updated_at = new Date().toISOString();
      return row;
    },
    async getLogistics(id) { return logistics.find(l => l.id === id); },
    async notifications(userId) { return notifications.filter(n => n.user_id === userId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); },
    async markNotificationRead(id, userId) {
      const row = notifications.find(n => n.id === id && n.user_id === userId);
      if (row) row.read_at = new Date().toISOString();
      return row;
    },
    async addNotification(userId, type, payload) {
      const row = { id: randomUUID(), user_id: userId, type, payload: payload ?? {}, read_at: null, created_at: new Date().toISOString() };
      notifications.push(row); return row;
    },
    async audit() { /* demo: audit tidak dipersistenkan */ },
    async usersByDinas(dinasId) { return users.filter(u => u.dinas_id === dinasId); },
  };
}
