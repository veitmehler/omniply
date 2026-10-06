-- Phone → PMS-patient index + backfill cursor (PMS framework v2):
-- Cliniko cannot filter patients by phone, so the sync feed doubles as our
-- phone-first match index for voice-caller booking.
ALTER TABLE "pms_sync_state" ADD COLUMN "backfillCursor" TEXT;

CREATE TABLE "pms_patient_index" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalPatientId" TEXT NOT NULL,
    "phoneNormalized" TEXT,
    "name" TEXT,
    "email" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_patient_index_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pms_patient_index_accountId_provider_externalPatientId_key" ON "pms_patient_index"("accountId", "provider", "externalPatientId");
CREATE INDEX "pms_patient_index_accountId_provider_phoneNormalized_idx" ON "pms_patient_index"("accountId", "provider", "phoneNormalized");

ALTER TABLE "pms_patient_index" ADD CONSTRAINT "pms_patient_index_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
