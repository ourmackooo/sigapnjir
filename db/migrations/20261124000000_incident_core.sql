-- SIGAP P0: fondasi insiden & koordinasi. Memperluas modul laporan yang sudah ada.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) UNIQUE NOT NULL,
  name varchar(120) NOT NULL,
  level text NOT NULL CHECK (level IN ('kabupaten','kecamatan','desa')),
  parent_id uuid REFERENCES public.zones(id) ON DELETE SET NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  population int NOT NULL DEFAULT 0 CHECK (population >= 0),
  vulnerable_population int NOT NULL DEFAULT 0 CHECK (vulnerable_population >= 0),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.disaster_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) UNIQUE NOT NULL,
  name varchar(160) NOT NULL,
  type text NOT NULL CHECK (type IN ('banjir','longsor')),
  status text NOT NULL DEFAULT 'siaga' CHECK (status IN ('siaga','tanggap_darurat','pemulihan','selesai')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  commander_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_zones (
  event_id uuid NOT NULL REFERENCES public.disaster_events(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waspada' CHECK (status IN ('waspada','terdampak','kritis','pulih')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','sensor','warga','petugas')),
  first_seen_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (event_id, zone_id)
);

ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.disaster_events(id) ON DELETE SET NULL;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES public.zones(id) ON DELETE SET NULL;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS impact jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified'
  CHECK (verification_status IN ('unverified','verified','duplicate','rejected'));
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'warga'
  CHECK (source IN ('warga','petugas','sensor'));

CREATE INDEX IF NOT EXISTS idx_reports_event_zone ON public.reports(event_id, zone_id);
CREATE INDEX IF NOT EXISTS idx_reports_verification ON public.reports(verification_status);

CREATE TABLE IF NOT EXISTS public.sensors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) UNIQUE NOT NULL,
  name varchar(120) NOT NULL,
  zone_id uuid REFERENCES public.zones(id) ON DELETE SET NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  warn_cm int NOT NULL CHECK (warn_cm >= 0),
  danger_cm int NOT NULL CHECK (danger_cm >= warn_cm),
  token_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sensor_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_id uuid NOT NULL REFERENCES public.sensors(id) ON DELETE CASCADE,
  water_cm int NOT NULL CHECK (water_cm >= 0),
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('normal','waspada','bahaya')),
  UNIQUE (sensor_id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_recent ON public.sensor_readings(sensor_id, recorded_at DESC);

ALTER TABLE public.dinas ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'dinas'
  CHECK (kind IN ('bpbd','polres','rs','relawan','pemdes','dinas'));
