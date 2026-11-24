import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Map, { Marker, NavigationControl, Popup } from "react-map-gl/maplibre";
import { addProtocol, removeProtocol, setWorkerUrl } from "maplibre-gl";
import { Protocol } from "pmtiles";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs" with { type: "file" };
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLE, INITIAL_VIEW } from "./MapView.jsx";

setWorkerUrl(workerUrl);
const protocol = new Protocol();
let activeMaps = 0;

const ZONE_TONE = { waspada: "#d97706", terdampak: "#ea580c", kritis: "#dc2626", pulih: "#059669" };

export default function IncidentMap({ zones = [], reports = [], sensors = [], shelters = [] }) {
  const mapRef = useRef(null);
  const [selected, setSelected] = useState(null);

  useLayoutEffect(() => {
    if (activeMaps++ === 0) addProtocol("pmtiles", protocol.tile);
  }, []);

  useEffect(() => () => {
    const map = mapRef.current?.getMap?.();
    if (map && !map._removed) map.remove();
    if (--activeMaps === 0) removeProtocol("pmtiles");
  }, []);

  const center = zones[0]
    ? { longitude: Number(zones[0].lng), latitude: Number(zones[0].lat), zoom: 12 }
    : INITIAL_VIEW;

  return <div className="incident-map">
    <Map ref={mapRef} mapStyle={MAP_STYLE} initialViewState={center} style={{ width: "100%", height: "100%" }}>
      {shelters.map(s => <Marker key={s.id} longitude={Number(s.lng)} latitude={Number(s.lat)} anchor="bottom" onClick={() => setSelected({ kind: "Shelter", title: s.name, detail: `${s.status} · ${s.occupancy}/${s.capacity} jiwa`, lng: Number(s.lng), lat: Number(s.lat) })}>
        <span className="incident-pin incident-pin--shelter" title="Shelter">S</span>
      </Marker>)}
      {sensors.map(s => s.lat != null && <Marker key={s.id} longitude={Number(s.lng)} latitude={Number(s.lat)} anchor="bottom" onClick={() => setSelected({ kind: "Sensor", title: s.name, detail: `Siaga ${s.warn_cm} cm · Bahaya ${s.danger_cm} cm`, lng: Number(s.lng), lat: Number(s.lat) })}>
        <span className="incident-pin incident-pin--sensor" title="Sensor">T</span>
      </Marker>)}
      {reports.filter(r => Number.isFinite(Number(r.lng))).map(r => <Marker key={r.id} longitude={Number(r.lng)} latitude={Number(r.lat)} anchor="center" onClick={() => setSelected({ kind: "Laporan", title: r.ticket_number, detail: `${r.verification_status} · ${r.impact?.jiwa ?? 0} jiwa`, lng: Number(r.lng), lat: Number(r.lat) })}>
        <span className={`incident-dot${r.verification_status === "verified" ? " incident-dot--verified" : ""}`} />
      </Marker>)}
      {zones.map(z => <Marker key={z.id} longitude={Number(z.lng)} latitude={Number(z.lat)} anchor="center" onClick={() => setSelected({ kind: "Zona", title: z.name, detail: `${z.status} · ${z.aggregate?.jiwa ?? 0} jiwa terdampak`, lng: Number(z.lng), lat: Number(z.lat) })}>
        <span className="incident-zone-wrap">
          <span className="incident-zone-halo" style={{ "--zone-color": ZONE_TONE[z.status] ?? "#64748b" }} />
          <span className="incident-zone" style={{ "--zone-color": ZONE_TONE[z.status] ?? "#64748b" }}>{z.name}</span>
        </span>
      </Marker>)}
      {selected && <Popup longitude={selected.lng} latitude={selected.lat} anchor="top" onClose={() => setSelected(null)} closeOnClick={false}>
        <div className="incident-popup"><strong>{selected.kind}: {selected.title}</strong><span>{selected.detail}</span></div>
      </Popup>}
      <NavigationControl position="bottom-right" />
    </Map>
    <div className="incident-legend">
      {Object.entries(ZONE_TONE).map(([status, color]) => <span key={status}><i style={{ background: color }} />{status}</span>)}
      <span><i className="incident-legend__shelter" />shelter</span>
      <span><i className="incident-legend__sensor" />sensor</span>
    </div>
  </div>;
}
