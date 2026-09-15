-- Embed parity batch B: automated post-enrichment Google-guidelines check
ALTER TABLE "article_jobs" ADD COLUMN "finalQualityVerdict" JSONB;
ALTER TABLE "article_jobs" ADD COLUMN "finalQualityAttempts" INTEGER NOT NULL DEFAULT 0;
