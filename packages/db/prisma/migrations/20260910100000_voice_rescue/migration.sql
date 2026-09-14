-- Voice rescue agent (.plans/voice-rescue-agent.implementation-plan.md):
-- second message-taking agent + no-ambiguity context linking.
ALTER TABLE "voice_agent_configs" ADD COLUMN "rescueAgentId" TEXT;
ALTER TABLE "voice_agent_configs" ADD COLUMN "rescueNumber" TEXT;
ALTER TABLE "voice_agent_configs" ADD COLUMN "rescueNumberSid" TEXT;
ALTER TABLE "voice_agent_configs" ADD COLUMN "rescueNumberId" TEXT;

ALTER TABLE "agent_conversations" ADD COLUMN "callerPhone" TEXT;
ALTER TABLE "agent_conversations" ADD COLUMN "rescuePendingAt" TIMESTAMP(3);
ALTER TABLE "agent_conversations" ADD COLUMN "rescueConsumedAt" TIMESTAMP(3);
ALTER TABLE "agent_conversations" ADD COLUMN "rescueSourceId" TEXT;
ALTER TABLE "agent_conversations" ADD COLUMN "rescueContext" TEXT;
