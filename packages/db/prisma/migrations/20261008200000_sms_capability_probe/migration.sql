-- SMS capability self-test (.plans/sms-capability-selftest.implementation-plan.md)
ALTER TABLE "voice_agent_configs" ALTER COLUMN "voiceSmsAvailable" SET DEFAULT false;
ALTER TABLE "voice_agent_configs" ADD COLUMN "smsProbeStatus" TEXT;
ALTER TABLE "voice_agent_configs" ADD COLUMN "smsProbeAt" TIMESTAMP(3);
