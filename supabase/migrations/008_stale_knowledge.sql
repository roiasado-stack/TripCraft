-- ============================================================================
-- TripCraft — migration 008
-- Freshness signal for the curated knowledge base: source_verified_on (006)
-- already records when a human last checked each fact. This adds the read
-- path to surface chunks overdue for re-verification, so staleness can be
-- caught (by an admin, or a scheduled n8n check) without ever auto-trusting
-- unverified content — the whole point of the verified-source design stays
-- intact. Admin-only, same SECURITY DEFINER + has_role pattern as agent_runs.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.stale_knowledge_chunks(threshold_months INT DEFAULT 6)
RETURNS TABLE (
  id UUID,
  destination TEXT,
  category TEXT,
  title TEXT,
  source_url TEXT,
  source_verified_on DATE,
  days_stale INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT k.id, k.destination, k.category, k.title, k.source_url, k.source_verified_on,
         (CURRENT_DATE - k.source_verified_on)::INT AS days_stale
  FROM public.knowledge_chunks k
  WHERE k.source_verified_on < (CURRENT_DATE - (threshold_months || ' months')::INTERVAL)
  ORDER BY k.source_verified_on ASC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.stale_knowledge_chunks(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stale_knowledge_chunks(int) TO authenticated;
