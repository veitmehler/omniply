-- Authority Content Engine (azavea v1): persisted shuffled-bag rotation state
-- + the dominant register assigned to each syndication platform article.
ALTER TABLE "brand_settings" ADD COLUMN "authorityEngineState" JSONB;
ALTER TABLE "syndication_articles" ADD COLUMN "register" TEXT;
