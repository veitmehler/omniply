-- Story bank (2026-11-11): client_stories becomes the one pool that feeds articles and
-- social story arcs. Rows may come from Google reviews (as before), from the onboarding
-- transcripts (split + sanitized), or be entered by hand. The review link becomes optional.
ALTER TABLE "client_stories" ALTER COLUMN "sourceReviewId" DROP NOT NULL;
ALTER TABLE "client_stories" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'review';
ALTER TABLE "client_stories" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'client_case';
ALTER TABLE "client_stories" ADD COLUMN "originalText" TEXT;
ALTER TABLE "client_stories" ADD COLUMN "sourceHash" TEXT;
CREATE UNIQUE INDEX "client_stories_accountId_sourceHash_key" ON "client_stories"("accountId", "sourceHash");
