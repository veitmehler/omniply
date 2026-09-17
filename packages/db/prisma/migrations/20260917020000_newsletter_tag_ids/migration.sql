-- Multi-tag newsletter audience (Veit: newsletter-subscriber + spine-check-lead).
ALTER TABLE "ghl_settings" ADD COLUMN "newsletterTagIds" JSONB;
