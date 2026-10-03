-- Voice-agent direct booking (missed-call sweep Part 4a):
-- per-account target calendar + audit table of agent-created appointments.
ALTER TABLE "accounts" ADD COLUMN "agentBookingCalendarId" TEXT;

CREATE TABLE "agent_appointments" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationId" TEXT,
    "ghlEventId" TEXT NOT NULL,
    "ghlContactId" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_appointments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_appointments_accountId_idx" ON "agent_appointments"("accountId");

ALTER TABLE "agent_appointments" ADD CONSTRAINT "agent_appointments_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
