-- SIGAP P0: koordinasi organisasi, task, shelter, dan override prioritas.
CREATE TABLE IF NOT EXISTS public.shelters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  capacity int NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  occupancy int NOT NULL DEFAULT 0 CHECK (occupancy >= 0),
  status text NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','penuh','tutup')),
  contact varchar(80),
  needs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.disaster_events(id) ON DELETE CASCADE,
  dinas_id uuid NOT NULL REFERENCES public.dinas(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('komando','SAR','kesehatan','keamanan','logistik','relawan')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (event_id, dinas_id)
);

CREATE TABLE IF NOT EXISTS public.incident_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.disaster_events(id) ON DELETE CASCADE,
  dinas_id uuid NOT NULL REFERENCES public.dinas(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  due_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_event_dinas ON public.incident_tasks(event_id, dinas_id);

CREATE TABLE IF NOT EXISTS public.priority_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.disaster_events(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  score numeric(5,4) NOT NULL CHECK (score >= 0 AND score <= 1),
  reason text NOT NULL,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (event_id, zone_id)
);
