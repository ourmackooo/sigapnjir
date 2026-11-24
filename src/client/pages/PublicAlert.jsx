import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Notice, dateText } from "../components/ReportWidgets.jsx";

const EVENT_STATUS = { siaga: "Siaga", tanggap_darurat: "Tanggap darurat", pemulihan: "Pemulihan", selesai: "Selesai" };
const ZONE_STATUS = { waspada: "Waspada", terdampak: "Terdampak", kritis: "Kritis", pulih: "Pulih" };

export default function PublicAlert({ eventId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    api(`/events/${eventId}/alert`).then(r => { if (active) setData(r); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [eventId, retry]);
  return <section className="lk-page container alert-page">
    <p className="lk-kicker">PERINGATAN PUBLIK SIGAP</p>
    {error && <Notice error>{error} <button className="lk-inline-button" onClick={() => setRetry(retry + 1)}>Coba lagi</button></Notice>}
    {!data && !error && <Notice>Memuat status bencana...</Notice>}
    {data && <>
      <div className="alert-hero">
        <span className={`lk-badge lk-badge--${data.event.status}`}>{EVENT_STATUS[data.event.status] ?? data.event.status}</span>
        <h1>{data.event.name}</h1>
        <p className="lk-intro">{data.event.type} · mulai {dateText(data.event.started_at)} · diperbarui {dateText(data.updated_at)}</p>
        <p className="lk-muted">Halaman ini tidak memuat data pribadi. Ikuti arahan petugas di lapangan.</p>
      </div>
      <div className="lk-detail-layout">
        <section className="lk-panel">
          <h2>Zona terdampak</h2>
          <div className="lk-table-wrap"><table className="lk-table"><thead><tr><th>Zona</th><th>Status</th><th>KK</th><th>Jiwa</th><th>Air</th></tr></thead><tbody>
            {data.zones.map(zone => <tr key={zone.code}><td data-label="Zona">{zone.name}</td><td data-label="Status">{ZONE_STATUS[zone.status] ?? zone.status}</td><td data-label="KK">{zone.aggregate.kk}</td><td data-label="Jiwa">{zone.aggregate.jiwa}</td><td data-label="Air">{zone.aggregate.ketinggian_air_cm} cm</td></tr>)}
          </tbody></table></div>
          {data.zones.length === 0 && <Notice>Belum ada zona terdampak yang terverifikasi.</Notice>}
        </section>
        <div>
          <section className="lk-panel">
            <h2>Instruksi</h2>
            <ol className="lk-personal-list">{data.instructions.map(text => <li key={text}>{text}</li>)}</ol>
          </section>
          <section className="lk-panel">
            <h2>Shelter</h2>
            {data.shelters.length === 0 ? <Notice>Belum ada shelter terdaftar.</Notice> : <ul className="lk-personal-list">{data.shelters.map(s => <li key={`${s.name}-${s.contact}`}><strong>{s.name}</strong><small>{s.status} · {s.occupancy}/{s.capacity} jiwa · {s.contact || "kontak belum tersedia"}</small></li>)}</ul>}
          </section>
        </div>
      </div>
    </>}
  </section>;
}
