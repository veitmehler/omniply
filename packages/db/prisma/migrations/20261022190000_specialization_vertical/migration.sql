-- Vertical-aware specialization registry: existing rows are all chiro
-- specializations (the default backfills them); recovery_wellness becomes
-- the wellness vertical's permanently-enabled specialization — the manual
-- "flip enabled at launch" checklist switch is retired.
ALTER TABLE "specializations" ADD COLUMN "vertical" TEXT NOT NULL DEFAULT 'chiro';
UPDATE "specializations" SET "vertical" = 'wellness', "enabled" = true WHERE "key" = 'recovery_wellness';
