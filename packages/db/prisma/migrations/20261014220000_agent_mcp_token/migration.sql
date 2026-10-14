-- Direct agent booking (MCP plan Phase 1): per-clinic public MCP token,
-- separate from agentWidgetToken so it is independently revocable.
ALTER TABLE "accounts" ADD COLUMN "agentMcpToken" TEXT;
CREATE UNIQUE INDEX "accounts_agentMcpToken_key" ON "accounts"("agentMcpToken");
