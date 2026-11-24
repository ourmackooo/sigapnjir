import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { randomBytes } from "node:crypto";
import { hashPassword, safeUser, verifyPassword } from "./auth.js";
import { createDemoStore } from "./demo-store.js";
import { createPostgresStore } from "./postgres-store.js";
import { saveImage } from "./storage.js";
import { canManage, publicReport, validateUpdate } from "../shared/reports.js";
import { aggregateImpact, normalizeImpact, readingStatus, validateImpact, zoneStatusForReading } from "../shared/incidents.js";
import { normalizeIsolation, rankZone } from "../shared/dss.js";
import { hashSensorToken as hashSensorTokenLocal, verifySensorToken } from "./sensor-token.js";
import { publish, subscribe } from "./events-bus.js";
import { sendBroadcast } from "./broadcast.js";
import { enqueueJob } from "./queue.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenOf = request => request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
const fail = (set, status, error) => { set.status = status; return { error }; };
const visible = r => r.is_public && r.moderation_status === "published";
const EVENT_ROLES = ["admin", "pemerintah"];
const isStaff = user => EVENT_ROLES.includes(user?.role);
const haversineKm = (a, b) => {
  if (!a || !b) return null;
  const rad = deg => deg * Math.PI / 180;
  const dLat = rad(Number(b.lat) - Number(a.lat));
  const dLng = rad(Number(b.lng) - Number(a.lng));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(Number(a.lat))) * Math.cos(rad(Number(b.lat))) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};
const eventCode = () => `EV-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
const TASK_STATUSES = ["open", "in_progress", "done"];
const PARTICIPANT_ROLES = ["komando", "SAR", "kesehatan", "keamanan", "logistik", "relawan"];

export function createApi({ demo = Bun.env.DEMO_MODE === "true", store = demo ? createDemoStore() : createPostgresStore() } = {}) {
  const currentUser = request => store.session(tokenOf(request));
  // # ponytail: state OAuth disimpan di memori (cukup untuk 1 instance).
  // Pindah ke Redis bila nanti >1 instance.
  const google = {
    clientId: Bun.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: Bun.env.GOOGLE_CLIENT_SECRET ?? "",
    enabled: Boolean(Bun.env.GOOGLE_CLIENT_ID && Bun.env.GOOGLE_CLIENT_SECRET),
  };
  const googleStates = new Map();
  const googleRedirect = request => `${new URL(request.url).origin}/api/auth/google/callback`;
  // # ponytail: rate-limit ingest in-memory; batasi per proses, cukup untuk demo/1 instance.
  const sensorHits = new Map();
  const sensorRateLimited = code => {
    const now = Date.now();
    const hits = (sensorHits.get(code) ?? []).filter(t => now - t < 60000);
    hits.push(now);
    sensorHits.set(code, hits);
    return hits.length > 60;
  };
  const staffOrFail = async (request, set) => {
    const user = await currentUser(request);
    if (!user) { fail(set, 401, "Silakan masuk terlebih dahulu."); return null; }
    if (!isStaff(user)) { fail(set, 403, "Halaman ini khusus BPBD dan PIC instansi."); return null; }
    return user;
  };
  const notifyDinas = async (dinasId, type, payload) => {
    if (!dinasId) return;
    const dinas = (await store.dinas()).find(d => d.id === dinasId);
    if (dinas?.pic_user_id) {
      await store.addNotification(dinas.pic_user_id, type, payload);
      return;
    }
    for (const user of await store.usersByDinas(dinasId)) await store.addNotification(user.id, type, payload);
  };
  const bpbdOnly = async (request, set) => {
    const user = await staffOrFail(request, set);
    if (!user) return null;
    if (user.role !== "admin") { fail(set, 403, "Tindakan ini hanya untuk BPBD sebagai pusat koordinasi."); return null; }
    return user;
  };
  const broadcast = async (user, eventId, message) => sendBroadcast({
    message, recipients: 0, eventId,
    audit: meta => store.audit({ actor_id: user.id, actor_type: user.role, ...meta }),
  });
  const computeEventPriority = async eventId => {
    const zones = await store.eventZones(eventId);
    const reports = await store.reportsForEvent(eventId);
    const shelters = await store.shelters();
    const sensors = (await store.listSensors()).filter(s => zones.some(z => z.id === s.zone_id));
    const overrides = new Map((await store.priorityOverrides(eventId)).map(o => [o.zone_id, o]));
    const data = [];
    for (const zone of zones) {
      const aggregate = aggregateImpact(reports.filter(r => r.zone_id === zone.id));
      const zoneSensors = sensors.filter(s => s.zone_id === zone.id);
      let latestReading = null;
      let trend = [];
      for (const sensor of zoneSensors) {
        const rows = await store.recentReadingsForSensor(sensor.id, 3);
        if (rows.length && (!latestReading || String(rows[0].recorded_at) > String(latestReading.recorded_at))) {
          latestReading = { ...rows[0], danger_cm: sensor.danger_cm };
          trend = [...rows].reverse();
        }
      }
      const distances = shelters.map(s => haversineKm(zone, s)).filter(Number.isFinite);
      const isolation = normalizeIsolation({
        aksesJalanTerputus: aggregate.akses_jalan,
        shelterDistanceKm: distances.length ? Math.min(...distances) : null,
      });
      const ranked = rankZone({ zone, aggregate, latestReading, readings: trend, isolation });
      const override = overrides.get(zone.id);
      data.push({
        ...ranked,
        aggregate,
        latest_reading: latestReading,
        status: zone.status,
        override: override ? { score: Number(override.score), reason: override.reason, created_at: override.created_at } : null,
        final_score: override ? Number(override.score) : ranked.score,
      });
    }
    return data.sort((a, b) => b.final_score - a.final_score);
  };
  const eventPayload = async eventId => {
    const event = await store.getEvent(eventId);
    if (!event) return null;
    const zones = await store.eventZones(eventId);
    const reports = await store.reportsForEvent(eventId);
    const shelters = (await store.shelters()).filter(s => zones.some(z => z.id === s.zone_id));
    return { event, zones, reports, shelters };
  };
  return new Elysia({ prefix: "/api" })
    .use(swagger({ path: "/docs" }))
    .onError(({ code, error, set }) => {
      if (code === "NOT_FOUND") return fail(set, 404, "Alamat API tidak ditemukan.");
      console.error("API error:", error.message);
      return fail(set, code === "VALIDATION" || code === "PARSE" ? 400 : 500,
        "Permintaan gagal. Periksa koneksi database dan jalankan migrasi, lalu coba kembali.");
    })
    .get("/health", () => ({ status: "ok", service: "sigap" }))
    .get("/meta", () => ({ demo, demo_accounts: demo ? [
      { label: "Warga", email: "warga@demo.test", password: "WargaDemo123!" },
      { label: "BPBD (pusat koordinasi)", email: "admin@demo.test", password: "AdminDemo123!" },
      { label: "PIC Dinas PU", email: "petugas@demo.test", password: "PetugasDemo123!" },
      { label: "PIC BPBD", email: "bpbd@demo.test", password: "BpbdDemo123!" },
      { label: "PIC Polres", email: "polres@demo.test", password: "PicDemo123!" },
      { label: "PIC RSUD", email: "rsud@demo.test", password: "PicDemo123!" },
      { label: "PIC PMI", email: "pmi@demo.test", password: "PicDemo123!" },
    ] : [], google_enabled: google.enabled }))
    .post("/auth/register", async ({ body, set }) => {
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      const fullName = String(body?.full_name ?? "").trim().slice(0, 150) || null;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 255) return fail(set, 400, "Masukkan email yang valid.");
      if (password.length < 8 || password.length > 256) return fail(set, 400, "Password harus 8–256 karakter.");
      try {
        const user = await store.register(email, hashPassword(password), fullName);
        set.status = 201;
        return { user: safeUser(user) };
      } catch (e) {
        if (e.code === "23505") return fail(set, 409, "Email sudah terdaftar.");
        throw e;
      }
    })
    .post("/auth/login", async ({ body, set }) => {
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      if (password.length > 256) return fail(set, 400, "Email atau password salah.");
      const user = await store.userByEmail(email);
      if (!user || !verifyPassword(password, user.password_hash)) return fail(set, 401, "Email atau password salah.");
      if (!user.is_active) return fail(set, 403, "Akun dinonaktifkan.");
      const token = randomBytes(32).toString("hex");
      await store.login(token, user.id);
      return { token, user: safeUser(user) };
    })
    .get("/auth/me", async ({ request, set }) => {
      const user = await currentUser(request);
      return user ? { user: safeUser(user) } : fail(set, 401, "Silakan masuk terlebih dahulu.");
    })
    .post("/auth/logout", async ({ request }) => { await store.logout(tokenOf(request)); return { ok: true }; })
    .get("/auth/google", ({ request, set }) => {
      if (!google.enabled) return fail(set, 400, "Masuk dengan Google belum dikonfigurasi.");
      const state = randomBytes(24).toString("hex");
      googleStates.set(state, Date.now() + 10 * 60 * 1000);
      const params = new URLSearchParams({
        client_id: google.clientId,
        redirect_uri: googleRedirect(request),
        response_type: "code",
        scope: "openid email profile",
        state,
        prompt: "select_account",
      });
      return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    })
    .get("/auth/google/callback", async ({ request, query, set }) => {
      if (!google.enabled) return fail(set, 400, "Masuk dengan Google belum dikonfigurasi.");
      const state = String(query?.state ?? "");
      if (!state || !googleStates.has(state) || googleStates.get(state) < Date.now()) {
        return fail(set, 400, "Sesi Google tidak valid atau kedaluwarsa. Coba lagi.");
      }
      googleStates.delete(state);
      const code = String(query?.code ?? "");
      if (!code) return fail(set, 400, "Google tidak mengembalikan kode otorisasi.");
      const redirectUri = googleRedirect(request);
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const tokens = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !tokens.access_token) return fail(set, 400, "Gagal menukar kode Google. Coba lagi.");
      const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });
      const info = await infoRes.json().catch(() => ({}));
      const email = String(info?.email ?? "").trim().toLowerCase();
      if (!infoRes.ok || !email || !info?.verified_email) return fail(set, 400, "Email Google tidak terverifikasi.");
      let user = await store.userByEmail(email);
      if (!user) {
        try {
          user = await store.register(email, hashPassword(randomBytes(24).toString("hex")), String(info?.name ?? "").trim().slice(0, 150) || null);
        } catch (e) {
          if (e.code === "23505") user = await store.userByEmail(email);
          else throw e;
        }
      }
      if (!user || !user.is_active) return fail(set, 403, "Akun dinonaktifkan.");
      const token = randomBytes(32).toString("hex");
      await store.login(token, user.id);
      const payload = Buffer.from(JSON.stringify(safeUser(user))).toString("base64url");
      return Response.redirect(`/?oauth_token=${token}&oauth_user=${payload}`);
    })
    .get("/dinas", async ({ request, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      return { data: await store.dinas() };
    })
    .post("/faq/questions", async ({ request, body, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk untuk bertanya.");
      const question = String(body?.question ?? "").trim();
      if (question.length < 10 || question.length > 2000) return fail(set, 400, "Tulis pertanyaan 10–2.000 karakter.");
      const row = await store.askFaqQuestion(user.id, question);
      set.status = 201;
      return { question: row };
    })
    .get("/faq/questions/mine", async ({ request, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      return { data: await store.faqQuestionsByUser(user.id) };
    })
    .get("/faq/questions", async ({ request, query, set }) => {
      const user = await currentUser(request);
      if (user?.role !== "admin") return fail(set, user ? 403 : 401, "Halaman ini khusus BPBD.");
      const status = query?.status === "answered" ? "answered" : query?.status === "open" ? "open" : null;
      return { data: await store.faqQuestions(status) };
    })
    .post("/faq/questions/:id/answer", async ({ request, params, body, set }) => {
      const user = await currentUser(request);
      if (user?.role !== "admin") return fail(set, user ? 403 : 401, "Halaman ini khusus BPBD.");
      const answer = String(body?.answer ?? "").trim();
      if (!answer || answer.length > 3000) return fail(set, 400, "Isi jawaban 1–3.000 karakter.");
      const row = await store.answerFaqQuestion(params.id, user.id, answer);
      if (!row) return fail(set, 404, "Pertanyaan tidak ditemukan.");
      return { question: row };
    })
    .post("/submit-laporan", async ({ request, body, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk untuk mengirim laporan.");
      const raw = String(body?.description_raw ?? "").trim();
      if (raw.length < 10 || raw.length > 12000) return fail(set, 400, "Isi laporan harus 10–12.000 karakter.");
      const image = body?.image_url ?? null;
      if (image && !/^\/uploads\/laporkuy\/[a-f0-9]{32}\.(png|jpg|webp)$/.test(image)) return fail(set, 400, "Alamat foto tidak valid.");
      // Fitur peta: titik lokasi wajib (mengembalikan lat/lng setelah migrasi kolom koordinat).
      const { lat, lng } = body ?? {};
      if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
        return fail(set, 400, "Pilih titik lokasi di peta terlebih dahulu.");
      }
      const address = typeof body?.address === "string" && body.address.trim()
        ? body.address.trim() : null;
      const dinasId = body?.dinas_id ?? null;
      if (dinasId && !(await store.dinas()).some(d => d.id === dinasId)) return fail(set, 400, "Dinas tidak valid.");
      const impactError = validateImpact(body?.impact);
      if (impactError) return fail(set, 400, impactError);
      const eventId = body?.event_id || null;
      const zoneId = body?.zone_id || null;
      if (eventId) {
        if (!(await store.getEvent(eventId))) return fail(set, 400, "Event bencana tidak ditemukan.");
        if (zoneId && !(await store.listZones()).some(z => z.id === zoneId)) return fail(set, 400, "Zona tidak ditemukan.");
      }
      const report = await store.createReport({
        ticket_number: `LPK-${randomBytes(8).toString("hex").toUpperCase()}`,
        user_id: user.id, description_raw: raw, image_url: image, is_public: body?.is_public === true,
        lat, lng, address, event_id: eventId, zone_id: zoneId,
        impact: normalizeImpact(body?.impact),
        source: eventId && isStaff(user) ? "petugas" : "warga",
      });
      set.status = 201;
      if (eventId) publish(eventId, { type: "report_created", report_id: report.id, zone_id: zoneId });
      // Pelapor memilih dinas tujuan langsung -> permintaan perutean untuk admin; bukan via sistem Jev.
      if (dinasId) {
        const rr = await store.requestReroute(report.id, user, dinasId, null);
        if (rr?.error) return fail(set, 409, "Perutean sudah berjalan.");
      } else if (!demo) {
        // Fire-and-forget ke queue AI Jev; pelapor tidak menunggu hasil routing.
        enqueueJob(report.id).catch(e => console.error("queue submit gagal:", e.message));
      }
      return { report: await store.get(report.id) };
    })
    .post("/upload-image", async ({ request, set }) => {
      if (!(await currentUser(request))) return fail(set, 401, "Silakan masuk untuk mengunggah foto.");
      const form = await request.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return fail(set, 400, "Pilih foto terlebih dahulu.");
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return fail(set, 400, "Gunakan foto PNG, JPG, atau WebP.");
      if (!file.size || file.size > 5 * 1024 * 1024) return fail(set, 400, "Ukuran foto harus 1 byte sampai 5 MB.");
      const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const signatureOK = file.type === "image/png" ? [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)
        : file.type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
      if (!signatureOK) return fail(set, 400, "Isi berkas bukan gambar yang valid.");
      set.status = 201;
      return { image_url: await saveImage(file, demo) };
    }, { parse: "none" })
    .get("/log", async ({ request, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk untuk melihat riwayat.");
      return { data: (await store.list()).filter(r => r.user_id === user.id) };
    })
    .get("/log/:id", async ({ request, params, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk untuk melihat detail laporan.");
      const row = await store.get(params.id);
      if (!row || row.user_id !== user.id) return fail(set, 404, "Laporan tidak ditemukan pada akunmu.");
      return { report: row, history: await store.history(row.id), feedbacks: await store.feedbacks(row.id, user.id), pendingRouting: await store.pendingRoutingRequest(row.id) };
    })
    .post("/log/:id/reroute", async ({ request, params, body, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      const row = await store.get(params.id);
      if (!row || row.user_id !== user.id) return fail(set, 404, "Laporan tidak ditemukan pada akunmu.");
      const dinasId = String(body?.dinas_id ?? "");
      if (!dinasId || !(await store.dinas()).some(d => d.id === dinasId)) return fail(set, 400, "Pilih dinas tujuan.");
      const note = String(body?.note ?? "").trim().slice(0, 2000);
      const out = await store.requestReroute(row.id, user, dinasId, note);
      if (!out) return fail(set, 404, "Laporan tidak ditemukan.");
      if (out.error === "already_pending") return fail(set, 409, "Permintaan perutean masih menunggu persetujuan admin.");
      if (out.error) return fail(set, 400, "Permintaan perutean gagal.");
      return { report: await store.get(row.id), history: await store.history(row.id), feedbacks: await store.feedbacks(row.id, user.id), pendingRouting: await store.pendingRoutingRequest(row.id) };
    })
    .post("/log/:id/feedbacks", async ({ request, params, body, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      const row = await store.get(params.id);
      if (!row || row.user_id !== user.id) return fail(set, 404, "Laporan tidak ditemukan pada akunmu.");
      const message = String(body?.message ?? "").trim();
      if (!message || message.length > 2000) return fail(set, 400, "Tulis masukan 1–2.000 karakter.");
      const feedback = await store.addFeedback(row.id, user, message);
      return { feedback, feedbacks: await store.feedbacks(row.id, user.id) };
    })
    .post("/log/:id/resolution", async ({ request, params, body, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      const action = body?.action;
      if (!["approve", "reject"].includes(action)) return fail(set, 400, "Aksi tidak valid.");
      const outcome = await store.respondResolution(params.id, action, user.id);
      if (!outcome) return fail(set, 404, "Laporan tidak ditemukan pada akunmu.");
      if (outcome.error === "no_request") return fail(set, 409, "Tidak ada permintaan penyelesaian untuk laporan ini.");
      if (outcome.error) return fail(set, 400, "Aksi tidak valid.");
      return { report: await store.get(params.id), history: await store.history(params.id) };
    })
    .get("/reports", async ({ query }) => {
      const q = String(query.q ?? "").toLowerCase().trim();
      const data = (await store.list()).filter(visible).map(publicReport).filter(r =>
        (!query.status || r.status === query.status) &&
        (!q || [r.title,r.location,r.description,r.ticket_number,r.dinas_name].some(s => String(s ?? "").toLowerCase().includes(q)))
      );
      const page = Math.max(1, Math.floor(Number(query.page) || 1));
      return { data: data.slice((page - 1) * 12, page * 12), total: data.length, page };
    })
    .get("/reports/:ticket", async ({ params, set }) => {
      const row = await store.ticket(params.ticket.toUpperCase());
      return row && visible(row) ? { report: publicReport(row) } : fail(set, 404, "Laporan publik tidak ditemukan.");
    })
    .get("/chat-stats", async () => {
      const rows = (await store.list()).filter(visible);
      return { data: [
        { name: "Resolved", value: rows.filter(r => r.status === "resolved").length },
        { name: "Active", value: rows.filter(r => ["accepted","in_progress"].includes(r.status)).length },
        { name: "Waiting", value: rows.filter(r => ["submitted","needs_review"].includes(r.status)).length },
        { name: "Escalated", value: rows.filter(r => r.status === "needs_review").length },
      ] };
    })
    .get("/government/reports", async ({ request, query, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      if (!["admin","pemerintah"].includes(user.role)) return fail(set, 403, "Halaman ini khusus BPBD dan PIC instansi.");
      const all = (await store.list()).filter(r => canManage(user,r));
      const q = String(query.q ?? "").toLowerCase().trim();
      const data = all.filter(r => (!query.status || r.status === query.status) &&
        (!q || `${r.description_raw} ${r.ticket_number}`.toLowerCase().includes(q)));
      const page = Math.max(1, Math.floor(Number(query.page) || 1));
      return { data: data.slice((page - 1) * 12, page * 12), total: data.length, page,
        summary: { total: all.length, waiting: all.filter(r => ["submitted","needs_review"].includes(r.status)).length,
          active: all.filter(r => ["accepted","in_progress"].includes(r.status)).length,
          resolved: all.filter(r => r.status === "resolved").length } };
    })
    .get("/government/stats", async ({ request, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      if (!["admin","pemerintah"].includes(user.role)) return fail(set, 403, "Halaman ini khusus BPBD dan PIC instansi.");
      const rows = (await store.list()).filter(r => canManage(user, r));
      const url = new URL(request.url);
      const group = new Set(["day","week","month"]).has(url.searchParams.get("group")) ? url.searchParams.get("group") : "day";
      const range = new Set(["week","month","year"]).has(url.searchParams.get("range")) ? url.searchParams.get("range") : "month";
      const from = new Date(Date.now() - ({ week: 7, month: 30, year: 365 }[range]) * 86400000);
      const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const weekStart = d => { const s = dayStart(d); const w = (s.getDay() + 6) % 7; s.setDate(s.getDate() - w); return s; };
      const monthStart = d => new Date(d.getFullYear(), d.getMonth(), 1);
      const keyOf = group === "day" ? dayStart : group === "week" ? weekStart : monthStart;
      const label = d => d.toISOString().slice(0, 10);
      const buckets = new Map();
      for (const r of rows) {
        const t = new Date(r.submitted_at);
        if (t < from) continue;
        const k = label(keyOf(t));
        buckets.set(k, (buckets.get(k) ?? 0) + 1);
      }
      const bar = [...buckets.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([b, count]) => ({ label: b, count }));
      const pie = new Map();
      for (const r of rows) {
        const name = r.urgency ?? "unknown";
        pie.set(name, (pie.get(name) ?? 0) + 1);
      }
      return { bar, pie: [...pie.entries()].map(([name, value]) => ({ name, value })) };
    })
    .get("/government/dinas", async ({ request, set }) => {
      const user = await currentUser(request);
      return ["admin","pemerintah"].includes(user?.role) ? { data: await store.dinas() } : fail(set, user ? 403 : 401, "Akses BPBD/PIC diperlukan.");
    })
    .get("/government/reports/:id", async ({ request, params, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      if (!UUID.test(params.id)) return fail(set,404,"Laporan tidak ditemukan.");
      const row = await store.get(params.id);
      if (!row || !canManage(user,row)) return fail(set,404,"Laporan tidak ditemukan atau bukan kewenangan dinasmu.");
      return { report: row, history: await store.history(row.id), feedbacks: await store.feedbacks(row.id, user.id), pendingRouting: await store.pendingRoutingRequest(row.id) };
    })
    .post("/government/reports/:id/reroute-decision", async ({ request, params, body, set }) => {
      const user = await currentUser(request);
      if (user?.role !== "admin") return fail(set, 403, "Hanya BPBD yang dapat memutuskan perutean.");
      if (!UUID.test(params.id)) return fail(set,404,"Laporan tidak ditemukan.");
      const decision = body?.decision;
      if (!["approve", "reject"].includes(decision)) return fail(set, 400, "Keputusan tidak valid.");
      const pending = await store.pendingRoutingRequest(params.id);
      if (!pending) return fail(set, 409, "Tidak ada permintaan perutean yang menunggu.");
      const note = String(body?.note ?? "").trim().slice(0, 2000);
      const out = await store.decideReroute(params.id, pending.id, user, decision, note);
      if (!out) return fail(set, 404, "Laporan tidak ditemukan.");
      if (out.error) return fail(set, 409, "Permintaan perutean sudah diputuskan.");
      const report = await store.get(params.id);
      // Penolakan pada laporan baru (belum pernah dirutekan) -> kembali ke jalur sistem Jev.
      if (!demo && report.status === "submitted") enqueueJob(report.id).catch(e => console.error("queue submit gagal:", e.message));
      return { report, history: await store.history(params.id), feedbacks: await store.feedbacks(params.id, user.id), pendingRouting: await store.pendingRoutingRequest(params.id) };
    })
    .post("/government/reports/:id/feedbacks", async ({ request, params, body, set }) => {
      const user = await currentUser(request);
      if (!["admin","pemerintah"].includes(user?.role)) return fail(set, user ? 403 : 401, "Akses BPBD/PIC diperlukan.");
      if (!UUID.test(params.id)) return fail(set,404,"Laporan tidak ditemukan.");
      const row = await store.get(params.id);
      if (!row || !canManage(user,row)) return fail(set,404,"Laporan tidak ditemukan atau bukan kewenangan dinasmu.");
      const message = String(body?.message ?? "").trim();
      if (!message || message.length > 2000) return fail(set, 400, "Tulis masukan 1–2.000 karakter.");
      const feedback = await store.addFeedback(row.id, user, message);
      return { feedback, feedbacks: await store.feedbacks(row.id, user.id) };
    })
    .post("/government/reports/:id/assign-dinas", async ({ request, params, body, set }) => {
      const user = await currentUser(request);
      if (user?.role !== "admin") return fail(set, 403, "Hanya BPBD yang dapat menetapkan dinas.");
      if (!UUID.test(params.id)) return fail(set,404,"Laporan tidak ditemukan.");
      const row = await store.get(params.id);
      if (!row) return fail(set,404,"Laporan tidak ditemukan.");
      const dinasId = body?.dinas_id || null;
      if (dinasId && !(await store.dinas()).some(d => d.id === dinasId)) return fail(set,400,"Dinas tidak valid.");
      const updated = await store.assignDinas(params.id, dinasId, user.id);
      if (!updated) return fail(set,404,"Laporan tidak ditemukan.");
      return { report: await store.get(params.id), history: await store.history(params.id) };
    })
    .patch("/government/reports/:id", async ({ request, params, body, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      if (user.role !== "pemerintah") return fail(set, 403, "Tindak lanjut laporan hanya dapat dilakukan PIC instansi; BPBD memantau.");
      if (!UUID.test(params.id)) return fail(set,404,"Laporan tidak ditemukan.");
      const row = await store.get(params.id);
      if (!row || !canManage(user,row)) return fail(set,404,"Laporan tidak ditemukan atau bukan kewenangan dinasmu.");
      const validation = validateUpdate(body,row,user);
      if (validation) return fail(set,400,validation);
      if (!body.expected_updated_at || !Number.isFinite(Date.parse(body.expected_updated_at))) return fail(set,400,"Muat ulang detail laporan sebelum menyimpan.");
      const dinasId = row.dinas_id;
      if (dinasId && !(await store.dinas()).some(d => d.id === dinasId)) return fail(set,400,"Dinas tidak valid.");
      const input = {
        status: body.status, progress_percent: Number(body.progress_percent), note: String(body.note).trim(), dinas_id: dinasId,
        moderation_status: row.moderation_status,
        public_title: row.public_title,
        public_location: row.public_location,
        description_redacted: row.description_redacted,
      };
      const updated = await store.update(row.id,input,user,body.expected_updated_at);
      if (!updated) return fail(set,409,"Laporan baru saja diperbarui petugas lain. Muat ulang detail sebelum menyimpan.");
      return { report: await store.get(row.id), history: await store.history(row.id), feedbacks: await store.feedbacks(row.id, user.id) };
    })

    // --- SIGAP: event, zona, sensor, koordinasi, DSS, logistik, notifikasi ---
    .get("/events", async ({ request, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      const events = await store.listEvents();
      const data = [];
      for (const event of events) data.push({ ...event, zone_count: (await store.eventZones(event.id)).length });
      return { data };
    })
    .post("/events", async ({ request, body, set }) => {
      const user = await bpbdOnly(request, set);
      if (!user) return;
      const name = String(body?.name ?? "").trim();
      if (name.length < 3 || name.length > 160) return fail(set, 400, "Nama event 3–160 karakter.");
      const type = body?.type === "longsor" ? "longsor" : "banjir";
      const status = ["siaga", "tanggap_darurat", "pemulihan", "selesai"].includes(body?.status) ? body.status : "siaga";
      const startedAt = body?.started_at ? new Date(body.started_at) : new Date();
      if (Number.isNaN(startedAt.getTime())) return fail(set, 400, "Waktu mulai event tidak valid.");
      const event = await store.createEvent({
        code: String(body?.code ?? "").trim() || eventCode(), name, type, status,
        started_at: startedAt,
        commander_id: user.role === "admin" ? (body?.commander_id ?? user.id) : user.id,
      });
      const zoneIds = Array.isArray(body?.zone_ids) ? body.zone_ids : [];
      const validZones = await store.listZones();
      for (const zoneId of zoneIds) if (validZones.some(z => z.id === zoneId)) await store.upsertEventZone(event.id, zoneId, { status: "waspada", source: "manual" });
      await store.audit({ actor_id: user.id, actor_type: user.role, action: "event_create", entity_type: "disaster_event", entity_id: event.id });
      set.status = 201;
      return { event };
    })
    .get("/events/:id", async ({ request, params, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      const event = await store.getEvent(params.id);
      if (!event) return fail(set, 404, "Event tidak ditemukan.");
      return { event, zones: await store.eventZones(event.id) };
    })
    .patch("/events/:id", async ({ request, params, body, set }) => {
      const user = await bpbdOnly(request, set);
      if (!user) return;
      const event = await store.getEvent(params.id);
      if (!event) return fail(set, 404, "Event tidak ditemukan.");
      if (body?.status && !["siaga", "tanggap_darurat", "pemulihan", "selesai"].includes(body.status)) return fail(set, 400, "Status event tidak valid.");
      const patch = {};
      for (const key of ["name", "type", "status", "ended_at", "commander_id"]) if (body?.[key] !== undefined) patch[key] = body[key];
      const updated = await store.updateEvent(event.id, patch);
      await store.audit({ actor_id: user.id, actor_type: user.role, action: "event_update", entity_type: "disaster_event", entity_id: event.id, metadata: patch });
      publish(event.id, { type: "event_updated", event: updated });
      return { event: updated };
    })
    .get("/events/:id/reports", async ({ request, params, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      return { data: await store.reportsForEvent(params.id) };
    })
    .get("/events/:id/zones", async ({ request, params, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      const zones = await store.eventZones(params.id);
      const reports = await store.reportsForEvent(params.id);
      return { data: zones.map(z => ({ ...z, aggregate: aggregateImpact(reports.filter(r => r.zone_id === z.id)) })) };
    })
    .get("/events/:id/priority", async ({ request, params, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      if (!(await store.getEvent(params.id))) return fail(set, 404, "Event tidak ditemukan.");
      return { data: await computeEventPriority(params.id) };
    })
    .post("/events/:id/priority/:zoneId/override", async ({ request, params, body, set }) => {
      const user = await bpbdOnly(request, set);
      if (!user) return;
      const reason = String(body?.reason ?? "").trim();
      if (reason.length < 10 || reason.length > 1000) return fail(set, 400, "Alasan override 10–1.000 karakter.");
      const ranked = await computeEventPriority(params.id);
      const current = ranked.find(z => z.zone_id === params.zoneId);
      if (!current) return fail(set, 404, "Zona bukan bagian dari event ini.");
      const score = body?.score === undefined ? current.final_score : Number(body.score);
      if (!Number.isFinite(score) || score < 0 || score > 1) return fail(set, 400, "Skor override harus 0–1.");
      const override = await store.upsertPriorityOverride({ event_id: params.id, zone_id: params.zoneId, score, reason, actor_id: user.id });
      await store.audit({ actor_id: user.id, actor_type: user.role, action: "priority_override", entity_type: "event_zone", entity_id: `${params.id}:${params.zoneId}`, metadata: { score, reason } });
      publish(params.id, { type: "priority_override", zone_id: params.zoneId, score, reason });
      return { override, data: await computeEventPriority(params.id) };
    })
    .get("/events/:id/stream", async ({ request, params, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      if (!isStaff(user)) return fail(set, 403, "Halaman ini khusus BPBD dan PIC instansi.");
      if (!(await store.getEvent(params.id))) return fail(set, 404, "Event tidak ditemukan.");
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("retry: 3000\n\n"));
          const unsubscribe = subscribe(params.id, controller);
          const timer = setInterval(() => {
            try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* stream sudah ditutup */ }
          }, 15000);
          request.signal.addEventListener("abort", () => { clearInterval(timer); unsubscribe(); });
        },
      });
      return new Response(stream, { headers: {
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no",
      } });
    })
    .post("/events/:id/broadcast", async ({ request, params, body, set }) => {
      const user = await bpbdOnly(request, set);
      if (!user) return;
      const event = await store.getEvent(params.id);
      if (!event) return fail(set, 404, "Event tidak ditemukan.");
      const message = String(body?.message ?? "").trim();
      if (message.length < 10 || message.length > 500) return fail(set, 400, "Pesan broadcast 10–500 karakter.");
      const participants = await store.eventParticipants(params.id);
      const result = await broadcast(user, params.id, message);
      for (const participant of participants) await notifyDinas(participant.dinas_id, "broadcast", { event_id: params.id, message });
      publish(params.id, { type: "broadcast", message, recipients: participants.length });
      return { ...result, sent: participants.length };
    })
    .get("/public/events", async () => {
      const events = (await store.listEvents()).filter(e => ["siaga", "tanggap_darurat", "pemulihan"].includes(e.status));
      const data = [];
      for (const event of events) data.push({ id: event.id, code: event.code, name: event.name, type: event.type, status: event.status, started_at: event.started_at, zones: await store.eventZones(event.id) });
      return { data };
    })
    .get("/events/:id/alert", async ({ params, set }) => {
      const payload = await eventPayload(params.id);
      if (!payload) return fail(set, 404, "Event tidak ditemukan.");
      const zones = payload.zones.map(zone => ({
        code: zone.code, name: zone.name, level: zone.level, status: zone.status,
        aggregate: aggregateImpact(payload.reports.filter(r => r.zone_id === zone.id)),
      }));
      const instructions = payload.event.status === "tanggap_darurat"
        ? ["Mengungsi ke shelter terdekat", "Bawa dokumen penting dan obat pribadi", "Hubungi petugas desa untuk bantuan evakuasi"]
        : payload.event.status === "pemulihan"
          ? ["Bersihkan rumah dengan hati-hati", "Gunakan air bersih", "Laporkan kerusakan ke petugas desa"]
          : ["Pantau informasi resmi BPBD", "Siapkan tas siaga bencana", "Hindari area sungai saat hujan deras"];
      return {
        event: { code: payload.event.code, name: payload.event.name, type: payload.event.type, status: payload.event.status, started_at: payload.event.started_at, updated_at: payload.event.updated_at },
        zones,
        shelters: payload.shelters.map(s => ({ name: s.name, status: s.status, capacity: s.capacity, occupancy: s.occupancy, contact: s.contact })),
        instructions,
        updated_at: new Date().toISOString(),
      };
    })
    .get("/event-zones", async ({ request, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      return { data: await store.listZones() };
    })
    .get("/sensors", async ({ request, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      const sensors = await store.listSensors();
      return { data: sensors.map(({ token_hash, ...rest }) => rest) };
    })
    .post("/sensors", async ({ request, body, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      if (user.role !== "admin") return fail(set, 403, "Hanya BPBD yang dapat menambah sensor.");
      const token = String(body?.token ?? "");
      if (token.length < 8) return fail(set, 400, "Token sensor minimal 8 karakter.");
      const code = String(body?.code ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9-]{3,32}$/.test(code)) return fail(set, 400, "Kode sensor 3–32 karakter huruf, angka, atau tanda hubung.");
      if (await store.sensorByCode(code)) return fail(set, 409, "Kode sensor sudah dipakai.");
      const zone = (await store.listZones()).find(z => z.id === body?.zone_id);
      if (!zone) return fail(set, 400, "Zona sensor tidak valid.");
      const warn = Number(body?.warn_cm ?? 100), danger = Number(body?.danger_cm ?? 150);
      if (!Number.isFinite(warn) || warn < 0 || !Number.isFinite(danger) || danger < warn) return fail(set, 400, "Ambang sensor tidak valid (bahaya harus ≥ siaga).");
      const lat = Number(body?.lat ?? zone.lat), lng = Number(body?.lng ?? zone.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(set, 400, "Koordinat sensor tidak valid.");
      const sensor = await store.createSensor({ code, name: String(body?.name ?? code).trim().slice(0, 120), zone_id: zone.id,
        lat, lng, warn_cm: warn, danger_cm: danger,
        token_hash: hashSensorTokenLocal(token) });
      const { token_hash, ...safe } = sensor;
      set.status = 201;
      return { sensor: safe };
    })
    .post("/sensors/:code/readings", async ({ request, params, body, set }) => {
      const sensor = await store.sensorByCode(params.code);
      if (!sensor || !sensor.is_active) return fail(set, 404, "Sensor tidak ditemukan atau nonaktif.");
      const token = request.headers.get("x-sensor-token") || body?.token || "";
      if (!verifySensorToken(token, sensor.token_hash)) return fail(set, 401, "Token sensor tidak valid.");
      if (sensorRateLimited(sensor.code)) return fail(set, 429, "Terlalu banyak kiriman data. Coba lagi sebentar.");
      const water_cm = Number(body?.water_cm);
      if (!Number.isFinite(water_cm) || water_cm < 0 || water_cm > 10000) return fail(set, 400, "Ketinggian air harus angka 0–10.000 cm.");
      const recordedAt = body?.recorded_at ? new Date(body.recorded_at) : new Date();
      if (Number.isNaN(recordedAt.getTime())) return fail(set, 400, "Waktu pembacaan tidak valid.");
      const status = readingStatus(water_cm, sensor.warn_cm, sensor.danger_cm);
      const reading = await store.addReading({ sensor_id: sensor.id, water_cm, recorded_at: recordedAt.toISOString(), status });
      if (!reading) return { duplicate: true, status };
      await store.touchSensor(sensor.id);
      const event = (body?.event_id && await store.getEvent(body.event_id)) || await store.activeEvent();
      let zoneStatus = null;
      if (event && sensor.zone_id) {
        zoneStatus = zoneStatusForReading(status);
        if (zoneStatus) await store.upsertEventZone(event.id, sensor.zone_id, { status: zoneStatus, source: "sensor" });
        if (status !== "normal") {
          await store.audit({ actor_type: "sensor", action: "sensor_alert", entity_type: "sensor", entity_id: sensor.id, metadata: { water_cm, status, event_id: event.id, zone_id: sensor.zone_id } });
          for (const participant of await store.eventParticipants(event.id)) await notifyDinas(participant.dinas_id, "sensor_alert", { event_id: event.id, zone_id: sensor.zone_id, code: sensor.code, water_cm, status });
          publish(event.id, { type: "sensor_reading", sensor: sensor.code, zone_id: sensor.zone_id, water_cm, status });
        }
      }
      set.status = 201;
      return { reading, status, zone_status: zoneStatus, event_id: event?.id ?? null };
    })
    .get("/government/verification", async ({ request, query, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      return { data: await store.pendingReports(query?.event_id || null) };
    })
    .patch("/government/reports/:id/verification", async ({ request, params, body, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      const row = await store.get(params.id);
      if (!row || !row.event_id) return fail(set, 404, "Laporan insiden tidak ditemukan.");
      const status = body?.verification_status;
      if (!["verified", "duplicate", "rejected", "unverified"].includes(status)) return fail(set, 400, "Status verifikasi tidak valid.");
      const impactError = validateImpact(body?.impact);
      if (impactError) return fail(set, 400, impactError);
      const zoneId = body?.zone_id ?? row.zone_id;
      if (zoneId && !(await store.listZones()).some(z => z.id === zoneId)) return fail(set, 400, "Zona tidak valid.");
      const impact = normalizeImpact({ ...(row.impact ?? {}), ...(body?.impact ?? {}) });
      const updated = await store.verifyReport(row.id, { verification_status: status, impact, zone_id: zoneId, verified_by: user.id });
      if (status === "verified" && zoneId) {
        const existing = (await store.eventZones(row.event_id)).find(z => z.id === zoneId);
        if (!existing) await store.upsertEventZone(row.event_id, zoneId, { status: "terdampak", source: "warga" });
      }
      await store.audit({ actor_id: user.id, actor_type: user.role, action: "report_verification", entity_type: "report", entity_id: row.id, metadata: { status, zone_id: zoneId } });
      if (row.event_id) publish(row.event_id, { type: "report_verified", report_id: row.id, zone_id: zoneId, status });
      return { report: updated };
    })
    .get("/events/:id/participants", async ({ request, params, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      return { data: await store.eventParticipants(params.id) };
    })
    .post("/events/:id/participants", async ({ request, params, body, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      if (user.role !== "admin") return fail(set, 403, "Hanya BPBD yang dapat menambah organisasi.");
      if (!(await store.getEvent(params.id))) return fail(set, 404, "Event tidak ditemukan.");
      if (!PARTICIPANT_ROLES.includes(body?.role)) return fail(set, 400, "Peran organisasi tidak valid.");
      if (!(await store.dinas()).some(d => d.id === body?.dinas_id)) return fail(set, 400, "Organisasi tidak valid.");
      const participant = await store.addParticipant(params.id, body.dinas_id, body.role);
      await store.audit({ actor_id: user.id, actor_type: user.role, action: "participant_add", entity_type: "disaster_event", entity_id: params.id, metadata: { dinas_id: body.dinas_id, role: body.role } });
      return { participant };
    })
    .get("/events/:id/tasks", async ({ request, params, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      if (!isStaff(user)) return fail(set, 403, "Halaman ini khusus BPBD dan PIC instansi.");
      if (user.role === "pemerintah" && !user.dinas_id) return fail(set, 403, "Akun PIC belum terhubung ke organisasi.");
      return { data: await store.tasksForEvent(params.id, user.role === "admin" ? null : user.dinas_id) };
    })
    .post("/events/:id/tasks", async ({ request, params, body, set }) => {
      const user = await bpbdOnly(request, set);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      if (!isStaff(user)) return fail(set, 403, "Halaman ini khusus BPBD dan PIC instansi.");
      const event = await store.getEvent(params.id);
      if (!event) return fail(set, 404, "Event tidak ditemukan.");
      const title = String(body?.title ?? "").trim();
      if (title.length < 3 || title.length > 200) return fail(set, 400, "Judul task 3–200 karakter.");
      const dinasId = user.role === "admin" ? body?.dinas_id : user.dinas_id;
      if (!dinasId || !(await store.dinas()).some(d => d.id === dinasId)) return fail(set, 400, "Organisasi penanggung jawab tidak valid.");
      const dueAt = body?.due_at ? new Date(body.due_at) : null;
      if (dueAt && Number.isNaN(dueAt.getTime())) return fail(set, 400, "Tenggat task tidak valid.");
      const task = await store.createTask({ event_id: params.id, dinas_id: dinasId, title,
        description: String(body?.description ?? "").trim() || null,
        due_at: dueAt?.toISOString() ?? null, created_by: user.id });
      await notifyDinas(dinasId, "task_assigned", { event_id: params.id, task_id: task.id, title });
      await store.audit({ actor_id: user.id, actor_type: user.role, action: "task_create", entity_type: "incident_task", entity_id: task.id, metadata: { dinas_id: dinasId } });
      publish(params.id, { type: "task_created", task });
      set.status = 201;
      return { task };
    })
    .patch("/tasks/:id", async ({ request, params, body, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      if (!isStaff(user)) return fail(set, 403, "Halaman ini khusus BPBD dan PIC instansi.");
      const task = await store.getTask(params.id);
      if (!task) return fail(set, 404, "Task tidak ditemukan.");
      if (user.role !== "admin" && task.dinas_id !== user.dinas_id) return fail(set, 403, "Task ini milik organisasi lain.");
      if (body?.status !== undefined && !TASK_STATUSES.includes(body.status)) return fail(set, 400, "Status task tidak valid.");
      const patch = {};
      for (const key of ["title", "description", "status"]) if (body?.[key] !== undefined) patch[key] = body[key];
      const updated = await store.updateTask(task.id, patch);
      await store.audit({ actor_id: user.id, actor_type: user.role, action: "task_update", entity_type: "incident_task", entity_id: task.id, metadata: patch });
      publish(task.event_id, { type: "task_updated", task: updated });
      return { task: updated };
    })
    .get("/government/pic", async ({ request, set }) => {
      const user = await bpbdOnly(request, set);
      if (!user) return;
      return { data: await store.dinas() };
    })
    .post("/government/dinas/:id/pic", async ({ request, params, body, set }) => {
      const user = await bpbdOnly(request, set);
      if (!user) return;
      const dinas = (await store.dinas()).find(d => d.id === params.id);
      if (!dinas) return fail(set, 404, "Organisasi tidak ditemukan.");
      const target = await store.userByEmail(String(body?.email ?? "").trim().toLowerCase());
      if (!target || target.role !== "pemerintah") return fail(set, 400, "Akun PIC harus terdaftar dengan peran PIC.");
      if (target.dinas_id !== dinas.id) return fail(set, 400, "Akun PIC harus terhubung ke organisasi ini.");
      const updated = await store.setPic(dinas.id, target.id);
      await store.audit({ actor_id: user.id, actor_type: user.role, action: "pic_assign", entity_type: "dinas", entity_id: dinas.id, metadata: { email: target.email } });
      return { dinas: updated };
    })
    .get("/shelters", async ({ request, query, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      return { data: await store.shelters(query?.zone_id || null) };
    })
    .post("/shelters", async ({ request, body, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      const name = String(body?.name ?? "").trim();
      if (!name) return fail(set, 400, "Nama shelter wajib diisi.");
      if (!(await store.listZones()).some(z => z.id === body?.zone_id)) return fail(set, 400, "Zona shelter tidak valid.");
      const lat = Number(body?.lat), lng = Number(body?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(set, 400, "Koordinat shelter tidak valid.");
      const capacity = Number(body?.capacity ?? 0), occupancy = Number(body?.occupancy ?? 0);
      if (!Number.isFinite(capacity) || capacity < 0 || !Number.isFinite(occupancy) || occupancy < 0) return fail(set, 400, "Kapasitas dan hunian shelter harus angka tidak negatif.");
      if (!["aktif", "penuh", "tutup"].includes(body?.status ?? "aktif")) return fail(set, 400, "Status shelter tidak valid.");
      const shelter = await store.createShelter({ zone_id: body.zone_id, name, lat, lng,
        capacity, occupancy, status: body?.status ?? "aktif", contact: body?.contact ?? null,
        needs: Array.isArray(body?.needs) ? body.needs.map(String) : [] });
      set.status = 201;
      return { shelter };
    })
    .patch("/shelters/:id", async ({ request, params, body, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      const patch = {};
      for (const key of ["name", "capacity", "occupancy", "status", "contact", "needs"]) if (body?.[key] !== undefined) patch[key] = body[key];
      for (const key of ["capacity", "occupancy"]) if (patch[key] !== undefined && (!Number.isFinite(Number(patch[key])) || Number(patch[key]) < 0)) return fail(set, 400, "Kapasitas dan hunian shelter harus angka tidak negatif.");
      if (patch.status !== undefined && !["aktif", "penuh", "tutup"].includes(patch.status)) return fail(set, 400, "Status shelter tidak valid.");
      const shelter = await store.updateShelter(params.id, patch);
      if (!shelter) return fail(set, 404, "Shelter tidak ditemukan.");
      await store.audit({ actor_id: user.id, actor_type: user.role, action: "shelter_update", entity_type: "shelter", entity_id: shelter.id, metadata: patch });
      return { shelter };
    })
    .get("/logistics", async ({ request, query, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      if (!query?.event_id) return fail(set, 400, "event_id wajib diisi.");
      return { data: await store.logisticsForEvent(query.event_id) };
    })
    .post("/logistics", async ({ request, body, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      if (!(await store.getEvent(body?.event_id))) return fail(set, 400, "Event tidak valid.");
      if (!(await store.shelters()).some(s => s.id === body?.shelter_id)) return fail(set, 400, "Shelter tidak valid.");
      const item = String(body?.item ?? "").trim();
      const qty = Number(body?.qty_requested);
      if (!item || item.length > 120) return fail(set, 400, "Nama barang wajib diisi.");
      if (!Number.isInteger(qty) || qty <= 0) return fail(set, 400, "Jumlah diminta harus bilangan bulat positif.");
      const row = await store.createLogistics({ event_id: body.event_id, shelter_id: body.shelter_id, item, qty_requested: qty, requested_by: user.id });
      await store.audit({ actor_id: user.id, actor_type: user.role, action: "logistics_request", entity_type: "logistics_request", entity_id: row.id });
      set.status = 201;
      return { request: row };
    })
    .patch("/logistics/:id", async ({ request, params, body, set }) => {
      const user = await staffOrFail(request, set);
      if (!user) return;
      const row = await store.getLogistics(params.id);
      if (!row) return fail(set, 404, "Permintaan logistik tidak ditemukan.");
      const allocated = body?.qty_allocated === undefined ? row.qty_allocated : Number(body.qty_allocated);
      const received = body?.qty_received === undefined ? row.qty_received : Number(body.qty_received);
      if (!Number.isInteger(allocated) || allocated < 0 || allocated > row.qty_requested) return fail(set, 400, "Alokasi harus 0 sampai jumlah diminta.");
      if (!Number.isInteger(received) || received < 0 || received > allocated) return fail(set, 400, "Jumlah diterima harus 0 sampai jumlah dialokasikan.");
      const status = allocated === 0 ? "requested" : received >= allocated ? "delivered" : received > 0 ? "partial" : "allocated";
      const updated = await store.updateLogistics(row.id, { qty_allocated: allocated, qty_received: received, status });
      await store.audit({ actor_id: user.id, actor_type: user.role, action: "logistics_update", entity_type: "logistics_request", entity_id: row.id, metadata: { allocated, received, status } });
      publish(row.event_id, { type: "logistics_updated", request: updated });
      return { request: updated };
    })
    .get("/notifications", async ({ request, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      return { data: await store.notifications(user.id) };
    })
    .post("/notifications/:id/read", async ({ request, params, set }) => {
      const user = await currentUser(request);
      if (!user) return fail(set, 401, "Silakan masuk terlebih dahulu.");
      const row = await store.markNotificationRead(params.id, user.id);
      if (!row) return fail(set, 404, "Notifikasi tidak ditemukan.");
      return { notification: row };
    });
}
