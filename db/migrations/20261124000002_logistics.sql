-- SIGAP P2: logistik minimal per shelter.
CREATE TABLE IF NOT EXISTS public.logistics_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.disaster_events(id) ON DELETE CASCADE,
  shelter_id uuid NOT NULL REFERENCES public.shelters(id) ON DELETE CASCADE,
  item varchar(120) NOT NULL,
  qty_requested int NOT NULL CHECK (qty_requested > 0),
  qty_allocated int NOT NULL DEFAULT 0 CHECK (qty_allocated >= 0),
  qty_received int NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','allocated','delivered','partial')),
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CHECK (qty_allocated <= qty_requested),
  CHECK (qty_received <= qty_allocated)
);

CREATE INDEX IF NOT EXISTS idx_logistics_event ON public.logistics_requests(event_id, shelter_id);
