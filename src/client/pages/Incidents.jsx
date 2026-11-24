import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Notice, dateText } from "../components/ReportWidgets.jsx";

const EVENT_STATUS = { siaga: "Siaga", tanggap_darurat: "Tanggap darurat", pemulihan: "Pemulihan", selesai: "Selesai" };

export default function Incidents({ user }) {
  const [events, setEvents] = useState(null);
  const [zones, setZones] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", type: "banjir", status: "siaga", zone_ids: [] });

  const load = () => {
    setError("");
    api("/events").then(r => setEvents(r.data)).catch(e => setError(e.message));
    api("/event-zones").then(r => setZones(r.data)).catch(() => {});
  };
  useEffect(load, []);

  function toggleZone(id) {
    setForm(f => ({ ...f, zone_ids: f.zone_ids.includes(id) ? f.zone_ids.filter(x => x !== id) : [...f.zone_ids, id] }));
  }
  async function create(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await api("/events", { method: "POST", body: JSON.stringify(form) });
      window.location.assign(`/pemerintah/insiden/${r.event.id}`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return <section className="lk-page container">
    <p className="lk-kicker">SIGAP — KOMANDO INSIDEN</p>
    <div className="lk-title-row"><h1>Insiden bencana</h1></div>
    <p className="lk-intro">Event menjadi payung laporan lapangan, zona terdampak, task organisasi, dan distribusi bantuan.</p>
    {error && <Notice error>{error}</Notice>}
    <div className="lk-detail-layout">
      <div>
        {!events && !error && <Notice>Memuat event...</Notice>}
        {events?.length === 0 && <Notice>Belum ada event. Buat event pertama untuk memulai.</Notice>}
        <div className="lk-cards">{events?.map(event => <article className="lk-card" key={event.id}>
          <div className="lk-title-row"><span className="lk-kicker">{event.code}</span><span className={`lk-badge lk-badge--${event.type}`}>{EVENT_STATUS[event.status] ?? event.status}</span></div>
          <h2><a href={`/pemerintah/insiden/${event.id}`}>{event.name}</a></h2>
          <p className="lk-muted">{event.type} · mulai {dateText(event.started_at)} · {event.zone_count} zona</p>
          <div className="lk-actions">
            <a className="btn btn--primary" href={`/pemerintah/insiden/${event.id}`}>Buka komando</a>
            <a className="btn btn--ghost" href={`/peringatan/${event.id}`} target="_blank" rel="noreferrer">Halaman peringatan</a>
          </div>
        </article>)}</div>
      </div>
      {user?.role === "admin" ? <form className="lk-panel lk-edit-form" onSubmit={create}>
        <h2>Buat event</h2>
        <label>Nama event<input required minLength={3} maxLength={160} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Contoh: Banjir Sungai Sejahtera" /></label>
        <label>Jenis<select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}><option value="banjir">Banjir</option><option value="longsor">Longsor</option></select></label>
        <label>Status<select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>{Object.entries(EVENT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <fieldset className="lk-zone-picker"><legend>Zona pantauan</legend>{zones.map(z => <label key={z.id} className="lk-checkbox"><input type="checkbox" checked={form.zone_ids.includes(z.id)} onChange={() => toggleZone(z.id)} /> {z.name} <small>{z.code}</small></label>)}</fieldset>
        <button className="btn btn--primary" disabled={busy}>{busy ? "Menyimpan..." : "Buat event"}</button>
      </form> : <div className="lk-panel"><h2>Pusat koordinasi BPBD</h2><p className="lk-muted">Hanya BPBD yang dapat membuat event. PIC instansi dapat membuka event untuk melihat zona, task instansinya, shelter, dan prioritas.</p></div>}
    </div>
  </section>;
}
