import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Notice, dateText } from "../components/ReportWidgets.jsx";

export default function VerifyQueue() {
  const [rows, setRows] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api("/government/verification"), api("/events")])
      .then(([pending, eventRows]) => { setRows(pending.data); setEvents(eventRows.data); })
      .catch(e => setError(e.message));
  }, []);
  const eventName = id => events.find(e => e.id === id)?.name ?? "Event";
  return <section className="lk-page container">
    <p className="lk-kicker">SIGAP — VERIFIKASI LAPANGAN</p>
    <h1>Antrean verifikasi</h1>
    <p className="lk-intro">Hanya laporan berstatus terverifikasi yang masuk ke agregat dampak dan skor prioritas.</p>
    {error && <Notice error>{error}</Notice>}
    {!rows && !error && <Notice>Memuat laporan...</Notice>}
    {rows?.length === 0 && <Notice>Tidak ada laporan yang menunggu verifikasi.</Notice>}
    <div className="lk-cards">{rows?.map(report => <article className="lk-card" key={report.id}>
      <div className="lk-title-row"><span className="lk-kicker">{report.ticket_number}</span><span className="lk-badge lk-badge--submitted">Belum diverifikasi</span></div>
      <h2>{report.description_raw?.split("\n")[0]}</h2>
      <p className="lk-muted">{eventName(report.event_id)} · {dateText(report.submitted_at)}</p>
      <p>{report.description_raw?.split("\n\n").at(-1)?.slice(0, 180)}</p>
      <p className="lk-muted">Dampak: {report.impact?.jiwa ?? 0} jiwa · {report.impact?.kk ?? 0} KK · air {report.impact?.ketinggian_air_cm ?? 0} cm</p>
      <a className="btn btn--primary" href={`/pemerintah/insiden/${report.event_id}`}>Verifikasi di ruang komando</a>
    </article>)}</div>
  </section>;
}
