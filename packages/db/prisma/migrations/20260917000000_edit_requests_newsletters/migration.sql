-- Edit requests generalized to newsletters (review UX plan phase 2).
ALTER TABLE "article_edit_requests" ALTER COLUMN "sitePageId" DROP NOT NULL;
ALTER TABLE "article_edit_requests" ADD COLUMN "newsletterId" TEXT;
ALTER TABLE "article_edit_requests" ADD CONSTRAINT "article_edit_requests_newsletterId_fkey"
  FOREIGN KEY ("newsletterId") REFERENCES "newsletters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "article_edit_requests_newsletterId_idx" ON "article_edit_requests"("newsletterId");
