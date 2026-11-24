import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Notice } from "../components/ReportWidgets.jsx";

export default function PicManagement() {
  const [rows, setRows] = useState(null);
  const [emails, setEmails] = useState({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState("");

  const load = () => {
    api("/government/pic").then(r => {
      setRows(r.data);
      setEmails(Object.fromEntries(r.data.map(d => [d.id, d.pic_email ?? ""])));
    }).catch(e => setError(e.message));
  };
  useEffect(load, []);

  async function save(dinas) {
    setBusy(dinas.id); setError(""); setSuccess("");
    try {
      await api(`/government/dinas/${dinas.id}/pic`, { method: "POST", body: JSON.stringify({ email: emails[dinas.id] }) });
      setSuccess(`PIC ${dinas.name} diperbarui.`); load();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }

  return <section className="lk-page container">
    <p className="lk-kicker">SIGAP — PUSAT KOORDINASI BPBD</p>
    <h1>PIC instansi</h1>
    <p className="lk-intro">Setiap organisasi menunjuk satu PIC. BPBD berkoordinasi melalui satu kontak per instansi, bukan banyak orang sekaligus. Akun PIC harus terdaftar dengan peran PIC dan terhubung ke organisasinya.</p>
    {error && <Notice error>{error}</Notice>}
    {success && <Notice>{success}</Notice>}
    {!rows && !error && <Notice>Memuat daftar organisasi...</Notice>}
    {rows && <div className="lk-table-wrap"><table className="lk-table"><thead><tr><th>Organisasi</th><th>Jenis</th><th>PIC saat ini</th><th>Email PIC</th><th>Aksi</th></tr></thead><tbody>
      {rows.map(dinas => <tr key={dinas.id}>
        <td data-label="Organisasi"><strong>{dinas.name}</strong><small>{dinas.slug}</small></td>
        <td data-label="Jenis">{dinas.kind}</td>
        <td data-label="PIC">{dinas.pic_name || "Belum ditunjuk"}<small>{dinas.pic_email || ""}</small></td>
        <td data-label="Email PIC"><input className="lk-inline-input lk-inline-input--wide" type="email" value={emails[dinas.id] ?? ""} onChange={e => setEmails(v => ({ ...v, [dinas.id]: e.target.value }))} placeholder="pic@instansi.test" /></td>
        <td data-label="Aksi"><button className="btn btn--ghost" disabled={busy === dinas.id || !emails[dinas.id]} onClick={() => save(dinas)}>{busy === dinas.id ? "..." : "Simpan"}</button></td>
      </tr>)}
    </tbody></table></div>}
  </section>;
}
