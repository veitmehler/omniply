-- GHL dashboard "AI Employee" embed: per-account read-only widget token.
ALTER TABLE "accounts" ADD COLUMN "dashboardWidgetToken" TEXT;
CREATE UNIQUE INDEX "accounts_dashboardWidgetToken_key" ON "accounts"("dashboardWidgetToken");
