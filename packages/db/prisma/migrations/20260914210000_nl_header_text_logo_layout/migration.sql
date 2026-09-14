-- Template polish batch (pre-launch): header text color + logo/name layout
ALTER TABLE "brand_settings" ADD COLUMN "nlHeaderTextColor" TEXT;
ALTER TABLE "brand_settings" ADD COLUMN "nlHeaderLogoLayout" TEXT;
