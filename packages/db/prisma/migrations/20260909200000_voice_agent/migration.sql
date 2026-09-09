-- Voice agent (ElevenLabs) — per-account custom-LLM secret + dashboard-card
-- dismissal + provisioning state table.
ALTER TABLE "accounts" ADD COLUMN "voiceAgentSecret" TEXT;
ALTER TABLE "accounts" ADD COLUMN "voiceAgentDismissedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "accounts_voiceAgentSecret_key" ON "accounts"("voiceAgentSecret");

CREATE TABLE "voice_agent_configs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "voiceId" TEXT,
    "agentId" TEXT,
    "phoneNumberId" TEXT,
    "phoneNumber" TEXT,
    "twilioSubaccountSid" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'overflow',
    "transferNumber" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_agent_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "voice_agent_configs_accountId_key" ON "voice_agent_configs"("accountId");
