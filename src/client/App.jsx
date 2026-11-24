import Header from "./components/Header.jsx";
import Footer from "./components/Footer.jsx";
import DemoBanner from "./components/DemoBanner.jsx";
import Landing from "./pages/Landing.jsx";
import Auth from "./pages/Auth.jsx";
import Report, { PersonalReport } from "./pages/Report.jsx";
import Government from "./pages/Government.jsx";
import PublicReports from "./pages/PublicReports.jsx";
import Info from "./pages/Info.jsx";
import Faq from "./pages/Faq.jsx";
import StaffLayout from "./components/StaffLayout.jsx";
import ReportLayout from "./components/ReportLayout.jsx";
import Incidents from "./pages/Incidents.jsx";
import IncidentDetail from "./pages/IncidentDetail.jsx";
import VerifyQueue from "./pages/VerifyQueue.jsx";
import Logistics from "./pages/Logistics.jsx";
import PublicAlert from "./pages/PublicAlert.jsx";
import PicManagement from "./pages/PicManagement.jsx";

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const oauthToken = params.get("oauth_token");
  const oauthUser = params.get("oauth_user");
  if (oauthToken && oauthUser) {
    try {
      const decoded = atob(oauthUser.replace(/-/g, "+").replace(/_/g, "/").padEnd(oauthUser.length + ((4 - (oauthUser.length % 4)) % 4), "="));
      const user = JSON.parse(decoded);
      localStorage.setItem("laporkuy_token", oauthToken);
      localStorage.setItem("laporkuy_user", JSON.stringify(user));
      window.location.replace(["admin", "pemerintah"].includes(user.role) ? "/pemerintah" : "/");
    } catch { /* token rusak; biarkan halaman berjalan normal */ }
  }
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const isAuth = path === "/masuk" || path === "/daftar";
  const publicTicket = path.match(/^\/laporan\/([^/]+)$/)?.[1];
  const governmentId = path.match(/^\/pemerintah\/laporan\/([^/]+)$/)?.[1];
  const incidentId = path.match(/^\/pemerintah\/insiden\/([^/]+)$/)?.[1];
  const alertId = path.match(/^\/peringatan\/([^/]+)$/)?.[1];
  const staffTicket = path.match(/^\/pemerintah\/katalog\/([^/]+)$/)?.[1];
  const staffCatalog = path === "/pemerintah/katalog" || Boolean(staffTicket);
  const staffArea = ["/pemerintah", "/pemerintah/daftar", "/pemerintah/tinjau", "/pemerintah/insiden", "/pemerintah/verifikasi", "/pemerintah/logistik", "/pemerintah/pic"].includes(path) || Boolean(governmentId) || Boolean(incidentId) || staffCatalog;
  if (alertId) return <><DemoBanner /><Header /><main id="main"><PublicAlert eventId={alertId} /></main><Footer /></>;
  if (staffArea) return <><DemoBanner /><a className="skip-link" href="#main">Lewati ke konten</a><StaffLayout path={path}>{user => {
    if (path === "/pemerintah/insiden") return <Incidents user={user} />;
    if (incidentId) return <IncidentDetail id={incidentId} user={user} />;
    if (path === "/pemerintah/verifikasi") return <VerifyQueue />;
    if (path === "/pemerintah/logistik") return <Logistics />;
    if (path === "/pemerintah/pic") return <PicManagement />;
    return staffCatalog
      ? <PublicReports ticket={staffTicket} staff />
      : <Government id={governmentId} user={user} view={path === "/pemerintah/daftar" ? "reports" : path === "/pemerintah/tinjau" ? "review" : "dashboard"} />;
  }}</StaffLayout></>;
  const logReportId = path.match(/^\/log\/laporan\/([^/]+)$/)?.[1];
  if (["/lapor", "/log"].includes(path) || Boolean(logReportId)) {
    return <><DemoBanner /><a className="skip-link" href="#main">Lewati ke konten</a><ReportLayout path={path}>{() => logReportId ? <PersonalReport id={logReportId} /> : <Report />}</ReportLayout></>;
  }
  let page;
  if (isAuth) page = <Auth mode={path === "/masuk" ? "login" : "register"} />;
  else if (path === "/faq") page = <Faq />;
  else if (path === "/laporan" || publicTicket) page = <PublicReports ticket={publicTicket} />;
  else if (path === "/") page = <Landing />;
  else page = <Info path={path} />;
  return <><DemoBanner />{!isAuth && <><a className="skip-link" href="#main">Lewati ke konten</a><Header /></>}<main id="main">{page}</main>{!isAuth && <Footer />}</>;
}
