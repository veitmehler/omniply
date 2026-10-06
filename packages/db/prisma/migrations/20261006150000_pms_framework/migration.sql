-- PMS framework v2 (.plans/pms-connector-framework.implementation-plan.md):
-- booking modes/tiers, provider-generalized audit, Tier-3 patterns, and
-- per-account PMS sync cursors.
ALTER TABLE "accounts" ADD COLUMN "agentBookingMode" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "accounts" ADD COLUMN "agentBookingConfig" JSONB;
ALTER TABLE "agent_appointments" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'ghl';
ALTER TABLE "brand_settings" ADD COLUMN "availabilityPatterns" TEXT;

-- Accounts already booking via a GHL calendar keep working (the demo).
UPDATE "accounts" SET "agentBookingMode" = 'direct-ghl' WHERE "agentBookingCalendarId" IS NOT NULL;

CREATE TABLE "pms_sync_state" (
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "patientsCursor" TIMESTAMP(3),
    "appointmentsCursor" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_sync_state_pkey" PRIMARY KEY ("accountId")
);

ALTER TABLE "pms_sync_state" ADD CONSTRAINT "pms_sync_state_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
