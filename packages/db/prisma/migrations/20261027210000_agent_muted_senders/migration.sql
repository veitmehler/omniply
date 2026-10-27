-- Bot-loop guard: senders detected as automated counterparts (self-identified
-- bots, verbatim-repeat loops) are muted per account; the GHL contact gets
-- channel-scoped DND as the clinic-visible marker/override surface.
CREATE TABLE "agent_muted_senders" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "visitorKey" TEXT NOT NULL,
    "ghlContactId" TEXT,
    "channel" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "agent_muted_senders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_muted_senders_accountId_visitorKey_key" ON "agent_muted_senders"("accountId", "visitorKey");

ALTER TABLE "agent_muted_senders" ADD CONSTRAINT "agent_muted_senders_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
