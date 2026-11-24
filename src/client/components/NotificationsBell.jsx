import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "../lib/api.js";

const TITLES = { sensor_alert: "Peringatan sensor", task_assigned: "Task baru", broadcast: "Broadcast terkirim", report_update: "Laporan diperbarui", resolution_rejected: "Laporan dikembalikan" };

export default function NotificationsBell() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const load = () => api("/notifications").then(r => setItems(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);
  const unread = items.filter(i => !i.read_at).length;
  async function read(id) {
    try { const r = await api(`/notifications/${id}/read`, { method: "POST" }); setItems(list => list.map(i => i.id === id ? r.notification : i)); }
    catch { /* biarkan notifikasi tetap tampil */ }
  }
  return <div className="lk-notif-wrap">
    <button type="button" className="btn btn--ghost lk-notif-toggle" aria-expanded={open} aria-label="Notifikasi" onClick={() => setOpen(v => !v)}>
      <Bell size={16} aria-hidden="true" /> Notifikasi {unread > 0 && <span className="lk-notif-count">{unread}</span>}
    </button>
    {open && <div className="lk-notif-panel" role="region" aria-label="Daftar notifikasi">
      {items.length === 0 ? <p className="lk-muted">Belum ada notifikasi.</p> : <ul>{items.slice(0, 10).map(item => <li key={item.id} className={item.read_at ? "" : "lk-notif-unread"} onClick={() => read(item.id)}>
        <strong>{TITLES[item.type] ?? item.type}</strong>
        <span>{item.payload?.title ?? item.payload?.message ?? item.payload?.code ?? ""}</span>
        {item.payload?.water_cm !== undefined && <small>{item.payload.water_cm} cm · {item.payload.status}</small>}
      </li>)}</ul>}
    </div>}
  </div>;
}
