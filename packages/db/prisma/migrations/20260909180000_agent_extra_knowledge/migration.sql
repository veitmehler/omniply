-- Freeform chat-agent knowledge: "anything else the assistant should know"
-- (Settings KB editor; 5000-char cap enforced at the API layer)
ALTER TABLE "brand_settings" ADD COLUMN "agentExtraKnowledge" TEXT;
