-- True-color logo variant (run-4 logo fix): the pipeline previously produced
-- ONLY white/navy silhouettes; the client's real logo colors were discarded.
ALTER TABLE "brand_settings" ADD COLUMN "nlLogoColorUrl" TEXT;
ALTER TABLE "brand_settings" ADD COLUMN "nlLogoColorLuminance" DOUBLE PRECISION;
