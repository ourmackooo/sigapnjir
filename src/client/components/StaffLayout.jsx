import { useEffect, useState } from "react";
import { LayoutDashboard, ClipboardList, ClipboardCheck, LogOut, Menu, X, Siren, ShieldCheck, Package, Users } from "lucide-react";
import { api, loginURL } from "../lib/api.js";
import { Notice } from "./ReportWidgets.jsx";
import NotificationsBell from "./NotificationsBell.jsx";

export default function StaffLayout({ path, children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api("/auth/me").then(({ user }) => {
      if (!active) return;
      setUser(user);
      localStorage.setItem("laporkuy_user", JSON.stringify(user));
    }).catch(e => { if (active) setError(e); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  useEffect(() => {
    if (!open) return;
    const close = event => {
      if (event.key === "Escape") {
        setOpen(false);
        document.getElementById("staff-menu-toggle")?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  async function logout() {
    setLeaving(true);
    try { await api("/auth/logout", { method: "POST" }); }
    catch { /* Tetap hapus sesi lokal jika server tidak dapat dihubungi. */ }
    localStorage.removeItem("laporkuy_token");
    localStorage.removeItem("laporkuy_user");
    window.location.assign("/masuk");
  }

  if (loading || error || !["admin", "pemerintah"].includes(user?.role)) {
    return <main id="main" className="lk-page container">
      <a className="brand" href="/">SIGAP<span className="brand__dot">.</span></a>
      <h1>Ruang kerja BPBD & PIC</h1>
      {loading ? <Notice>Memeriksa akses akun...</Notice> : error ? <Notice error>
        {error.message}{" "}
        {error.status === 401 ? <a className="lk-text-link" href={loginURL()}>Masuk sebagai petugas</a>
          : <button className="lk-inline-button" onClick={() => setRetry(v => v + 1)}>Coba lagi</button>}
      </Notice> : <Notice error>Halaman ini tersedia untuk BPBD dan PIC instansi. <a className="lk-text-link" href="/laporan">Kembali ke katalog masyarakat</a></Notice>}
    </main>;
  }

  const admin = user.role === "admin";
  const role = admin ? "BPBD" : "PIC instansi";
  const catalogue = path === "/pemerintah/katalog" || path.startsWith("/pemerintah/katalog/");
  const managing = path === "/pemerintah/daftar" || path.startsWith("/pemerintah/laporan/");
  const review = admin && path === "/pemerintah/tinjau";
  const incident = path.startsWith("/pemerintah/insiden");
  const verification = path === "/pemerintah/verifikasi";
  const logistics = path === "/pemerintah/logistik";
  const links = [
    { href: "/pemerintah", label: admin ? "Dashboard BPBD" : "Dashboard PIC", icon: LayoutDashboard, active: !managing && !review && !catalogue && !incident && !verification && !logistics && path !== "/pemerintah/pic" },
    { href: "/pemerintah/daftar", label: admin ? "Kelola Laporan" : "Laporan instansi", icon: ClipboardList, active: managing },
  ];
  if (admin) links.push({ href: "/pemerintah/tinjau", label: "Tinjau Laporan", icon: ClipboardCheck, active: review });
  links.push({ href: "/pemerintah/insiden", label: "Insiden", icon: Siren, active: incident });
  links.push({ href: "/pemerintah/verifikasi", label: "Verifikasi", icon: ShieldCheck, active: verification });
  links.push({ href: "/pemerintah/logistik", label: "Logistik", icon: Package, active: logistics });
  if (admin) links.push({ href: "/pemerintah/pic", label: "PIC Instansi", icon: Users, active: path === "/pemerintah/pic" });
  // Katalog publik di-comment sementara.
  // links.push({ href: "/pemerintah/katalog", label: "Katalog publik", icon: Globe2, active: catalogue });

  return <div className="lk-staff">
    <aside className="lk-staff__sidebar">
      <div className="lk-staff__brand-row">
        <a className="brand" href="/pemerintah" aria-label="SIGAP — dashboard petugas">SIGAP<span className="brand__dot">.</span></a>
        <button id="staff-menu-toggle" type="button" className="lk-staff__toggle" aria-controls="staff-navigation" aria-expanded={open} aria-label={open ? "Tutup navigasi petugas" : "Buka navigasi petugas"} onClick={() => setOpen(v => !v)}>{open ? <X size={20} /> : <Menu size={20} />}</button>
      </div>
      <nav id="staff-navigation" className={`lk-staff__navigation${open ? " lk-staff__navigation--open" : ""}`} aria-label={`Navigasi ${role.toLowerCase()}`}>
        <p className="lk-kicker">MENU UTAMA</p>
        {links.map(({ href, label, icon: Icon, active }) => <a key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}><Icon size={18} aria-hidden="true" /><span>{label}</span></a>)}
      </nav>
      <div className="lk-staff__account"><NotificationsBell /><strong>{user.full_name || role}</strong><span>{user.email}</span><button type="button" className="btn btn--ghost" disabled={leaving} onClick={logout}><LogOut size={16} aria-hidden="true" />{leaving ? "Keluar..." : "Keluar akun"}</button></div>
    </aside>
    <div className="lk-staff__workspace">
      <main id="main">{children(user)}</main>
      <footer className="lk-staff__footer">SIGAP · Ruang kerja {admin ? "BPBD" : "PIC instansi"}</footer>
    </div>
  </div>;
}
