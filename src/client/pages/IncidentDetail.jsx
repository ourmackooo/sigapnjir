import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Notice, dateText } from "../components/ReportWidgets.jsx";
import IncidentMap from "../components/IncidentMap.jsx";

const EVENT_STATUS = { siaga: "Siaga", tanggap_darurat: "Tanggap darurat", pemulihan: "Pemulihan", selesai: "Selesai" };
const ZONE_STATUS = { waspada: "Waspada", terdampak: "Terdampak", kritis: "Kritis", pulih: "Pulih" };
const TASK_STATUS = { open: "Terbuka", in_progress: "Dikerjakan", done: "Selesai" };
const ROLES = ["komando", "SAR", "kesehatan", "keamanan", "logistik", "relawan"];
const IMPACT_FIELDS = [["kk", "KK"], ["jiwa", "Jiwa"], ["korban_meninggal", "Meninggal"], ["lansia", "Lansia"], ["anak", "Anak"], ["disabilitas", "Disabilitas"], ["ibu_hamil", "Ibu hamil"], ["ketinggian_air_cm", "Air (cm)"]];

function ReportVerifyCard({ report, zones, onVerify, busy }) {
  const [impact, setImpact] = useState(() => ({ ...report.impact }));
  const [zoneId, setZoneId] = useState(report.zone_id || "");
  const change = (key, value) => setImpact(i => ({ ...i, [key]: value === "" ? 0 : Number(value) }));
  return <article className="lk-card lk-verify-card">
    <div className="lk-title-row"><strong>{report.ticket_number}</strong><span className="lk-muted">{dateText(report.submitted_at)}</span></div>
    <p className="lk-muted">{report.description_raw?.split("\n")[0]}</p>
    <div className="lk-impact-grid">
      {IMPACT_FIELDS.map(([key, label]) => <label key={key}>{label}<input type="number" min="0" value={impact[key] ?? 0} onChange={e => change(key, e.target.value)} /></label>)}
      <label className="lk-checkbox"><input type="checkbox" checked={Boolean(impact.akses_jalan)} onChange={e => setImpact(i => ({ ...i, akses_jalan: e.target.checked }))} /> Jalan terputus</label>
      <label>Zona<select value={zoneId} onChange={e => setZoneId(e.target.value)}><option value="">Pilih zona</option>{zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
    </div>
    <div className="lk-actions">
      <button className="btn btn--primary" disabled={busy || !zoneId} onClick={() => onVerify(report.id, "verified", impact, zoneId)}>Verifikasi</button>
      <button className="btn btn--ghost" disabled={busy} onClick={() => onVerify(report.id, "duplicate", impact, zoneId)}>Duplikat</button>
      <button className="btn btn--ghost" disabled={busy} onClick={() => onVerify(report.id, "rejected", impact, zoneId)}>Tolak</button>
    </div>
  </article>;
}

export default function IncidentDetail({ id, user }) {
  const [state, setState] = useState({ loading: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", dinas_id: "", description: "" });
  const [participantForm, setParticipantForm] = useState({ dinas_id: "", role: "komando" });
  const [shelterForm, setShelterForm] = useState({ name: "", zone_id: "", capacity: 100 });
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastInfo, setBroadcastInfo] = useState(null);
  const [override, setOverride] = useState({ zone_id: "", score: "", reason: "" });

  const load = useCallback(async () => {
    try {
      const [detail, zoneRows, priority, tasks, participants, pending, shelters, logistics, sensors, dinas] = await Promise.all([
        api(`/events/${id}`), api(`/events/${id}/zones`), api(`/events/${id}/priority`),
        api(`/events/${id}/tasks`), api(`/events/${id}/participants`), api(`/government/verification?event_id=${id}`),
        api("/shelters"), api(`/logistics?event_id=${id}`), api("/sensors"), api("/government/dinas"),
      ]);
      const reports = await api(`/events/${id}/reports`).catch(() => ({ data: [] }));
      setState({ loading: false, event: detail.event, zones: zoneRows.data, priority: priority.data, tasks: tasks.data,
        participants: participants.data, pending: pending.data, shelters: shelters.data, logistics: logistics.data,
        sensors: sensors.data, dinas: dinas.data, reports: reports.data });
      setError("");
    } catch (e) { setState({ loading: false }); setError(e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    const token = localStorage.getItem("laporkuy_token");
    const run = async () => {
      const res = await fetch(`/api/events/${id}/stream`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          if (chunk.split("\n").some(line => line.startsWith("data: "))) load();
        }
      }
    };
    run().catch(() => {});
    return () => controller.abort();
  }, [id, load]);

  async function verify(reportId, status, impact, zoneId) {
    setBusy(reportId); setError("");
    try {
      await api(`/government/reports/${reportId}/verification`, { method: "PATCH", body: JSON.stringify({ verification_status: status, impact, zone_id: zoneId || null }) });
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function createTask(event) {
    event.preventDefault(); setBusy("task"); setError("");
    try {
      await api(`/events/${id}/tasks`, { method: "POST", body: JSON.stringify(taskForm) });
      setTaskForm({ title: "", dinas_id: "", description: "" }); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function updateTask(taskId, status) {
    setBusy(taskId); setError("");
    try { await api(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status }) }); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function addParticipant(event) {
    event.preventDefault(); setBusy("participant"); setError("");
    try { await api(`/events/${id}/participants`, { method: "POST", body: JSON.stringify(participantForm) }); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function addShelter(event) {
    event.preventDefault(); setBusy("shelter"); setError("");
    try {
      const zone = state.zones.find(z => z.id === shelterForm.zone_id) ?? state.zones[0];
      await api("/shelters", { method: "POST", body: JSON.stringify({ ...shelterForm, zone_id: zone?.id, lat: zone?.lat, lng: zone?.lng }) });
      setShelterForm({ name: "", zone_id: "", capacity: 100 }); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function submitOverride(event) {
    event.preventDefault(); setBusy("override"); setError("");
    try {
      await api(`/events/${id}/priority/${override.zone_id}/override`, { method: "POST", body: JSON.stringify({ score: override.score === "" ? undefined : Number(override.score), reason: override.reason }) });
      setOverride({ zone_id: "", score: "", reason: "" }); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function broadcast(event) {
    event.preventDefault(); setBusy("broadcast"); setError("");
    try { const r = await api(`/events/${id}/broadcast`, { method: "POST", body: JSON.stringify({ message: broadcastText }) }); setBroadcastInfo(r.sent); setBroadcastText(""); }
    catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }

  if (state.loading && !error) return <div className="lk-page container"><Notice>Memuat ruang komando...</Notice></div>;
  if (error && !state.event) return <div className="lk-page container"><Notice error>{error}</Notice><a className="lk-text-link" href="/pemerintah/insiden">← Kembali ke daftar insiden</a></div>;
  if (!state.event) return null;

  const { event, zones = [], priority = [], tasks = [], participants = [], shelters = [], logistics = [], pending = [], dinas = [], reports = [], sensors = [] } = state;
  const totals = logistics.reduce((acc, row) => ({ requested: acc.requested + row.qty_requested, allocated: acc.allocated + row.qty_allocated, received: acc.received + row.qty_received }), { requested: 0, allocated: 0, received: 0 });
  const impacted = zones.reduce((acc, zone) => ({ jiwa: acc.jiwa + (zone.aggregate?.jiwa ?? 0), kk: acc.kk + (zone.aggregate?.kk ?? 0) }), { jiwa: 0, kk: 0 });
  const zoneIds = new Set(zones.map(z => z.id));
  const eventShelters = shelters.filter(s => zoneIds.has(s.zone_id));
  const eventSensors = sensors.filter(s => zoneIds.has(s.zone_id));

  return <section className="lk-page container">
    <div className="lk-detail-topbar"><a className="lk-text-link" href="/pemerintah/insiden">← Semua insiden</a></div>
    <div className="lk-title-row">
      <div><p className="lk-kicker">{event.code} · {event.type}</p><h1>{event.name}</h1></div>
      <span className="lk-badge lk-badge--accepted">{EVENT_STATUS[event.status] ?? event.status}</span>
    </div>
    <p className="lk-intro">Mulai {dateText(event.started_at)} · {zones.length} zona · {impacted.jiwa} jiwa terdampak terverifikasi</p>
    {error && <Notice error>{error}</Notice>}

    <div className="lk-stats">{[["Laporan", reports.length], ["Perlu verifikasi", pending.length], ["Zona", zones.length], ["Task", tasks.length]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>

    <div className="incident-map-wrap"><IncidentMap zones={zones} reports={reports} sensors={eventSensors} shelters={eventShelters} /></div>

    <div className="lk-detail-layout">
      <div>
        <section className="lk-panel">
          <div className="lk-title-row"><h2>Antrean verifikasi</h2><span className="lk-muted">{pending.length} laporan</span></div>
          {pending.length === 0 ? <Notice>Tidak ada laporan yang menunggu verifikasi.</Notice> : pending.map(report => <ReportVerifyCard key={report.id} report={report} zones={zones} busy={busy === report.id} onVerify={verify} />)}
        </section>

        <section className="lk-panel">
          <div className="lk-title-row"><h2>Prioritas DSS</h2><span className="lk-muted">0,35 severity + 0,25 affected + 0,15 vulnerable + 0,15 isolation + 0,10 time pressure</span></div>
          <div className="lk-table-wrap"><table className="lk-table"><thead><tr><th>Zona</th><th>Status</th><th>Skor</th><th>Faktor</th><th>Override</th></tr></thead><tbody>
            {priority.map(row => <tr key={row.zone_id}>
              <td data-label="Zona"><strong>{row.zone_name}</strong><small>{row.aggregate.jiwa} jiwa · air {row.latest_reading?.water_cm ?? row.aggregate.ketinggian_air_cm ?? 0} cm</small></td>
              <td data-label="Status">{ZONE_STATUS[row.status] ?? row.status}</td>
              <td data-label="Skor"><strong>{row.final_score.toFixed(3)}</strong>{row.override && <small> override</small>}</td>
              <td data-label="Faktor"><small>{Object.entries(row.contributions).map(([key, value]) => `${key} ${value.toFixed(3)}`).join(" · ")}</small></td>
              <td data-label="Override">{user?.role === "admin" ? <button className="lk-inline-button" onClick={() => setOverride({ zone_id: row.zone_id, score: row.final_score.toFixed(3), reason: "" })}>Ubah</button> : <small>khusus BPBD</small>}</td>
            </tr>)}
          </tbody></table></div>
          {priority.length === 0 && <Notice>Belum ada zona pada event ini.</Notice>}
          {override.zone_id && <form className="lk-edit-form" onSubmit={submitOverride}>
            <h3>Override prioritas</h3>
            <label>Skor 0–1<input type="number" min="0" max="1" step="0.001" value={override.score} onChange={e => setOverride(o => ({ ...o, score: e.target.value }))} /></label>
            <label>Alasan (wajib)<textarea required minLength={10} rows={2} value={override.reason} onChange={e => setOverride(o => ({ ...o, reason: e.target.value }))} placeholder="Contoh: akses jalan utama putus total." /></label>
            <div className="lk-actions"><button className="btn btn--primary" disabled={busy === "override"}>Simpan override</button><button type="button" className="btn btn--ghost" onClick={() => setOverride({ zone_id: "", score: "", reason: "" })}>Batal</button></div>
          </form>}
        </section>

        <section className="lk-panel">
          <div className="lk-title-row"><h2>Koordinasi organisasi</h2></div>
          <ul className="lk-personal-list">{participants.map(p => <li key={p.id}><strong>{p.dinas_name}</strong> <span className="lk-badge">{p.role}</span><small>PIC: {p.pic_name || "belum ditunjuk"}{p.pic_email ? ` · ${p.pic_email}` : ""}</small></li>)}</ul>
          {user?.role === "admin" && <form className="lk-edit-form" onSubmit={addParticipant}>
            <h3>Tambah organisasi</h3>
            <label>Organisasi<select required value={participantForm.dinas_id} onChange={e => setParticipantForm(f => ({ ...f, dinas_id: e.target.value }))}><option value="">Pilih organisasi</option>{dinas.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <label>Peran<select value={participantForm.role} onChange={e => setParticipantForm(f => ({ ...f, role: e.target.value }))}>{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></label>
            <button className="btn btn--primary" disabled={busy === "participant"}>Tambah</button>
          </form>}
        </section>

        <section className="lk-panel">
          <div className="lk-title-row"><h2>Task organisasi</h2><span className="lk-muted">Hanya task dinasmu yang tampil</span></div>
          {tasks.length === 0 ? <Notice>Belum ada task.</Notice> : <ul className="lk-personal-list">{tasks.map(task => <li key={task.id} className="lk-task-row">
            <div><strong>{task.title}</strong><small>{task.dinas_name}{task.description ? ` · ${task.description}` : ""}</small></div>
            <select value={task.status} disabled={busy === task.id} onChange={e => updateTask(task.id, e.target.value)}>{Object.entries(TASK_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </li>)}</ul>}
          {user?.role === "admin" && <form className="lk-edit-form" onSubmit={createTask}>
            <h3>Buat task</h3>
            <label>Judul<input required minLength={3} value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="Contoh: Evakuasi RT 03" /></label>
            {user?.role === "admin" && <label>Organisasi<select required value={taskForm.dinas_id} onChange={e => setTaskForm(f => ({ ...f, dinas_id: e.target.value }))}><option value="">Pilih organisasi</option>{dinas.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
            <label>Deskripsi<textarea rows={2} value={taskForm.description} onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))} /></label>
            <button className="btn btn--primary" disabled={busy === "task"}>Kirim task</button>
          </form>}
        </section>
      </div>

      <div>
        <section className="lk-panel">
          <div className="lk-title-row"><h2>Shelter</h2></div>
          {shelters.length === 0 ? <Notice>Belum ada shelter.</Notice> : <ul className="lk-personal-list">{shelters.map(s => <li key={s.id}><strong>{s.name}</strong><small>{s.status} · {s.occupancy}/{s.capacity} jiwa · {s.contact || "kontak belum ada"}</small></li>)}</ul>}
          <form className="lk-edit-form" onSubmit={addShelter}>
            <h3>Tambah shelter</h3>
            <label>Nama<input required value={shelterForm.name} onChange={e => setShelterForm(f => ({ ...f, name: e.target.value }))} /></label>
            <label>Zona<select required value={shelterForm.zone_id} onChange={e => setShelterForm(f => ({ ...f, zone_id: e.target.value }))}><option value="">Pilih zona</option>{zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
            <label>Kapasitas<input type="number" min="0" value={shelterForm.capacity} onChange={e => setShelterForm(f => ({ ...f, capacity: Number(e.target.value) }))} /></label>
            <button className="btn btn--primary" disabled={busy === "shelter"}>Tambah shelter</button>
          </form>
        </section>

        <section className="lk-panel">
          <div className="lk-title-row"><h2>Logistik</h2><a className="lk-text-link" href="/pemerintah/logistik">Kelola →</a></div>
          <div className="lk-stats"><div><span>Diminta</span><strong>{totals.requested}</strong></div><div><span>Dialokasikan</span><strong>{totals.allocated}</strong></div><div><span>Diterima</span><strong>{totals.received}</strong></div></div>
        </section>

        {user?.role === "admin" && <section className="lk-panel">
          <h2>Broadcast peringatan</h2>
          <p className="lk-muted">Stub satu arah. Pesan dicatat di audit log, bukan integrasi provider produksi.</p>
          <form className="lk-edit-form" onSubmit={broadcast}>
            {broadcastInfo !== null && <Notice>Stub broadcast terkirim ke {broadcastInfo} organisasi/penerima (dicatat di audit log).</Notice>}
            <label>Pesan<textarea required minLength={10} maxLength={500} rows={3} value={broadcastText} onChange={e => setBroadcastText(e.target.value)} placeholder="Contoh: Warga Desa Banjir Kidul diminta mengungsi ke balai desa." /></label>
            <button className="btn btn--primary" disabled={busy === "broadcast"}>Kirim broadcast</button>
          </form>
        </section>}

        <section className="lk-panel">
          <h2>Halaman publik</h2>
          <p className="lk-muted">Bagikan status bencana tanpa data pribadi.</p>
          <a className="btn btn--ghost" href={`/peringatan/${event.id}`} target="_blank" rel="noreferrer">Buka halaman peringatan</a>
        </section>
      </div>
    </div>
  </section>;
}
