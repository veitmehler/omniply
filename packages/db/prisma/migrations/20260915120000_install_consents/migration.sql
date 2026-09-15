-- Funnel+consent batch (§4b-3): website-install consents from onboarding
ALTER TABLE "brand_settings" ADD COLUMN "installConsents" JSONB;
