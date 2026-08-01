ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'mens-singles',
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS court_name text;

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_category_check;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_category_check CHECK (category IN ('mens-singles', 'womens-singles', 'mens-doubles', 'womens-doubles', 'mixed-doubles'));

CREATE INDEX IF NOT EXISTS matches_category_idx ON public.matches(category);
