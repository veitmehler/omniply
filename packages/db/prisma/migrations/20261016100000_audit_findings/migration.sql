-- Consistency audit (enrichment step 20.5): applied + rejected ops per article.
-- Rejected ops feed the Phase-2 client suggestion cards.
ALTER TABLE "site_pages" ADD COLUMN "auditFindingsJson" JSONB;
