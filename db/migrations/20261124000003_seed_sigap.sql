-- Seed idempoten SIGAP: organisasi, zona, satu event banjir, sensor, shelter, laporan contoh.
INSERT INTO public.dinas (id, slug, name, kind) VALUES
  ('10000000-0000-0000-0000-000000000001', 'bpbd', 'BPBD Kabupaten Sejahtera', 'bpbd'),
  ('10000000-0000-0000-0000-000000000002', 'polres', 'Polres Kabupaten Sejahtera', 'polres'),
  ('10000000-0000-0000-0000-000000000003', 'rsud', 'RSUD Kabupaten Sejahtera', 'rs'),
  ('10000000-0000-0000-0000-000000000004', 'pmi', 'PMI Kabupaten Sejahtera', 'relawan')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.zones (id, code, name, level, lat, lng, population, vulnerable_population) VALUES
  ('20000000-0000-0000-0000-000000000001', 'Z-KEC-01', 'Kecamatan Sejahtera', 'kecamatan', -7.9800, 112.6300, 42000, 5200),
  ('20000000-0000-0000-0000-000000000002', 'Z-DESA-01', 'Desa Banjir Kidul', 'desa', -7.9850, 112.6250, 8600, 1500),
  ('20000000-0000-0000-0000-000000000003', 'Z-DESA-02', 'Desa Tanggul Wetan', 'desa', -7.9750, 112.6380, 6400, 980)
ON CONFLICT (id) DO NOTHING;

UPDATE public.zones SET parent_id = '20000000-0000-0000-0000-000000000001'
WHERE id IN ('20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003');

INSERT INTO public.disaster_events (id, code, name, type, status, started_at) VALUES
  ('30000000-0000-0000-0000-000000000001', 'EV-2026-001', 'Banjir Sungai Sejahtera', 'banjir', 'tanggap_darurat', now() - interval '6 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_zones (event_id, zone_id, status, source) VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'kritis', 'sensor'),
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'waspada', 'sensor')
ON CONFLICT (event_id, zone_id) DO NOTHING;

INSERT INTO public.sensors (id, code, name, zone_id, lat, lng, warn_cm, danger_cm, token_hash) VALUES
  ('40000000-0000-0000-0000-000000000001', 'SEN-01', 'Sensor Banjir Kidul', '20000000-0000-0000-0000-000000000002', -7.9850, 112.6250, 120, 180, encode(digest('demo-sensor-1','sha256'),'hex')),
  ('40000000-0000-0000-0000-000000000002', 'SEN-02', 'Sensor Tanggul Wetan', '20000000-0000-0000-0000-000000000003', -7.9750, 112.6380, 100, 150, encode(digest('demo-sensor-2','sha256'),'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.shelters (id, zone_id, name, lat, lng, capacity, occupancy, status, contact, needs) VALUES
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Balai Desa Banjir Kidul', -7.9860, 112.6260, 300, 120, 'aktif', '081234567890', '["selimut","air bersih","makanan"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_participants (event_id, dinas_id, role) VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'komando'),
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'keamanan'),
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'kesehatan'),
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'relawan')
ON CONFLICT (event_id, dinas_id) DO NOTHING;

INSERT INTO public.incident_tasks (id, event_id, dinas_id, title, description, status) VALUES
  ('60000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Evakuasi warga Desa Banjir Kidul', 'Prioritaskan lansia dan anak-anak di RT 03.', 'open')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.reports (ticket_number, user_id, description_raw, lat, lng, address, event_id, zone_id, impact, verification_status, source, verified_at)
SELECT 'LPK-EVENT0001', u.id,
  'Air masuk rumah warga\nLokasi: RT 03 Desa Banjir Kidul\n\nAir setinggi pinggang, warga butuh evakuasi.', -7.9850, 112.6250, 'RT 03 Desa Banjir Kidul',
  '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
  '{"kk":42,"jiwa":168,"korban_meninggal":0,"lansia":18,"anak":34,"disabilitas":3,"ibu_hamil":4,"ketinggian_air_cm":140,"akses_jalan":true,"kebutuhan":["evakuasi","selimut","air bersih"]}'::jsonb,
  'verified', 'warga', now()
FROM public.users u WHERE u.email = 'siti.rahayu@example.com'
ON CONFLICT (ticket_number) DO NOTHING;

INSERT INTO public.reports (ticket_number, user_id, description_raw, lat, lng, address, event_id, zone_id, impact, verification_status, source)
SELECT 'LPK-EVENT0002', u.id,
  'Jalan desa terputus\nLokasi: Desa Tanggul Wetan\n\nAkses jalan tergenang, kendaraan tidak bisa lewat.', -7.9750, 112.6380, 'Desa Tanggul Wetan',
  '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003',
  '{"kk":12,"jiwa":45,"korban_meninggal":0,"lansia":5,"anak":9,"disabilitas":0,"ibu_hamil":1,"ketinggian_air_cm":90,"akses_jalan":true,"kebutuhan":["perahu karet"]}'::jsonb,
  'unverified', 'warga'
FROM public.users u WHERE u.email = 'siti.rahayu@example.com'
ON CONFLICT (ticket_number) DO NOTHING;

INSERT INTO public.logistics_requests (id, event_id, shelter_id, item, qty_requested, qty_allocated, qty_received, status) VALUES
  ('70000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'selimut', 200, 80, 0, 'allocated')
ON CONFLICT (id) DO NOTHING;
