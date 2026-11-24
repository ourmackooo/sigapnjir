-- Satu PIC per instansi. BPBD tetap menjadi pusat koordinasi (role admin internal).
ALTER TABLE public.dinas ADD COLUMN IF NOT EXISTS pic_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Buat akun PIC BPBD/Polres/RSUD/PMI memakai hash dari akun instansi seed.
INSERT INTO public.users (email, password_hash, full_name, role, dinas_id, is_active)
SELECT v.email, u.password_hash, v.full_name, 'pemerintah', d.id, true
FROM public.users u
CROSS JOIN (VALUES
  ('bpbd@example.com', 'bpbd', 'PIC BPBD'),
  ('polres@example.com', 'polres', 'PIC Polres'),
  ('rsud@example.com', 'rsud', 'PIC RSUD'),
  ('pmi@example.com', 'pmi', 'PIC PMI')
) AS v(email, slug, full_name)
JOIN public.dinas d ON d.slug = v.slug
WHERE u.email = 'instansi@laporkuy.dev'
ON CONFLICT (email) DO NOTHING;

-- Backfill: pilih satu petugas pemerintah aktif per dinas sebagai PIC.
UPDATE public.dinas d
SET pic_user_id = (
  SELECT u.id FROM public.users u
  WHERE u.dinas_id = d.id AND u.role = 'pemerintah' AND u.is_active = true
  ORDER BY u.created_at, u.id
  LIMIT 1
)
WHERE d.pic_user_id IS NULL;

-- Prioritaskan akun PIC khusus untuk BPBD, Polres, RSUD, dan PMI.
UPDATE public.dinas d
SET pic_user_id = u.id
FROM public.users u
WHERE u.email = d.slug || '@example.com'
  AND u.role = 'pemerintah'
  AND u.dinas_id = d.id
  AND d.slug IN ('bpbd','polres','rsud','pmi');

CREATE UNIQUE INDEX IF NOT EXISTS idx_dinas_pic_user ON public.dinas(pic_user_id) WHERE pic_user_id IS NOT NULL;
