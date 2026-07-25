
CREATE TABLE IF NOT EXISTS public.test_completion_debug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.test_completion_debug TO authenticated, service_role;
ALTER TABLE public.test_completion_debug ENABLE ROW LEVEL SECURITY;
CREATE POLICY "test_debug_open" ON public.test_completion_debug FOR ALL TO authenticated USING (true) WITH CHECK (true);
