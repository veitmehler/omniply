-- Voice SMS delivery (.plans/voice-sms-delivery.implementation-plan.md):
-- attempt-and-latch capability flag.
ALTER TABLE "voice_agent_configs" ADD COLUMN "voiceSmsAvailable" BOOLEAN NOT NULL DEFAULT true;
