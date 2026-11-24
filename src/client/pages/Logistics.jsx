import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Notice } from "../components/ReportWidgets.jsx";

const STATUS_LABEL = { requested: "Diminta", allocated: "Dialokasikan", partial: "Sebagian", delivered: "Diterima" };

export default function Logistics() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [rows, setRows] = useState([]);
  const [shelters, setShelters] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ shelter_id: "", item: "", qty_requested: 10 });
  const [edits, setEdits] = useState({});

  useEffect(() => {
    Promise.all([api("/events"), api("/shelters")])
      .then(([eventRows, shelterRows]) => {
        setEvents(eventRows.data); setShelters(shelterRows.data);
        if (eventRows.data[0]) setEventId(eventRows.data[0].id);
      })
      .catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    if (!eventId) return;
    api(`/logistics?event_id=${eventId}`).then(r => setRows(r.data)).catch(e => setError(e.message));
  }, [eventId]);
  async function create(event) {
    event.preventDefault(); setBusy("create"); setError("");
    try {
      await api("/logistics", { method: "POST", body: JSON.stringify({ ...form, event_id: eventId }) });
      setForm({ shelter_id: "", item: "", qty_requested: 10 });
      const r = await api(`/logistics?event_id=${eventId}`); setRows(r.data);
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function save(row) {
    setBusy(row.id); setError("");
    const edit = edits[row.id] ?? { qty_allocated: row.qty_allocated, qty_received: row.qty_received };
    try {
      await api(`/logistics/${row.id}`, { method: "PATCH", body: JSON.stringify({ qty_allocated: Number(edit.qty_allocated), qty_received: Number(edit.qty_received) }) });
      const r = await api(`/logistics?event_id=${eventId}`); setRows(r.data);
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  const setEdit = (row, key, value) => setEdits(e => ({ ...e, [row.id]: { ...(e[row.id] ?? { qty_allocated: row.qty_allocated, qty_received: row.qty_received }), [key]: value } }));

  return <section className="lk-page container">
    <p className="lk-kicker">SIGAP — LOGISTIK</p>
    <div className="lk-title-row"><h1>Distribusi bantuan</h1><select value={eventId} onChange={e => setEventId(e.target.value)} aria-label="Pilih event">{events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
    {error && <Notice error>{error}</Notice>}
    <div className="lk-table-wrap"><table className="lk-table"><thead><tr><th>Shelter / barang</th><th>Diminta</th><th>Dialokasikan</th><th>Diterima</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
      {rows.map(row => {
        const edit = edits[row.id] ?? { qty_allocated: row.qty_allocated, qty_received: row.qty_received };
        return <tr key={row.id}>
          <td data-label="Shelter"><strong>{row.shelter_name}</strong><small>{row.item}</small></td>
          <td data-label="Diminta">{row.qty_requested}</td>
          <td data-label="Dialokasikan"><input className="lk-inline-input" type="number" min="0" max={row.qty_requested} value={edit.qty_allocated} onChange={e => setEdit(row, "qty_allocated", e.target.value)} /></td>
          <td data-label="Diterima"><input className="lk-inline-input" type="number" min="0" max={edit.qty_allocated} value={edit.qty_received} onChange={e => setEdit(row, "qty_received", e.target.value)} /></td>
          <td data-label="Status">{STATUS_LABEL[row.status] ?? row.status}</td>
          <td data-label="Aksi"><button className="btn btn--ghost" disabled={busy === row.id} onClick={() => save(row)}>{busy === row.id ? "..." : "Simpan"}</button></td>
        </tr>;
      })}
    </tbody></table></div>
    {rows.length === 0 && <Notice>Belum ada permintaan logistik untuk event ini.</Notice>}
    <form className="lk-panel lk-edit-form" onSubmit={create}>
      <h2>Permintaan baru</h2>
      <label>Shelter<select required value={form.shelter_id} onChange={e => setForm(f => ({ ...f, shelter_id: e.target.value }))}><option value="">Pilih shelter</option>{shelters.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Barang<input required value={form.item} onChange={e => setForm(f => ({ ...f, item: e.target.value }))} placeholder="Contoh: selimut" /></label>
      <label>Jumlah<input required type="number" min="1" value={form.qty_requested} onChange={e => setForm(f => ({ ...f, qty_requested: Number(e.target.value) }))} /></label>
      <button className="btn btn--primary" disabled={busy === "create"}>Ajukan</button>
    </form>
  </section>;
}
