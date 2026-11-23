-- Admin System Health dashboard (2026-11-23): services we depend on or pay for,
-- the admin's top-up ledger for prepaid accounts that cannot be read by API
-- (Gemini, Anthropic, OpenAI), and hourly outcomes of our own provider calls.
CREATE TABLE "service_accounts" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "usedFor" TEXT NOT NULL DEFAULT '',
    "billing" TEXT NOT NULL,
    "balanceMode" TEXT NOT NULL DEFAULT 'none',
    "meteredProvider" TEXT,
    "callProvider" TEXT,
    "warnDays" INTEGER NOT NULL DEFAULT 14,
    "criticalDays" INTEGER NOT NULL DEFAULT 3,
    "rechargeUrl" TEXT,
    "statusFeedUrl" TEXT,
    "statusPageUrl" TEXT,
    "monthlyAmount" DOUBLE PRECISION,
    "renewsOn" TIMESTAMP(3),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "alertLevel" TEXT,
    "alertAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_accounts_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "service_ledger_entries" (
    "id" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_call_stats" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "bucket" TIMESTAMP(3) NOT NULL,
    "ok" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorStatus" INTEGER,
    "lastErrorMessage" TEXT,

    CONSTRAINT "provider_call_stats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_spend" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "calls" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "provider_spend_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_spend_provider_at_idx" ON "provider_spend"("provider", "at");
CREATE INDEX "provider_spend_at_idx" ON "provider_spend"("at");
CREATE INDEX "service_ledger_entries_serviceKey_at_idx" ON "service_ledger_entries"("serviceKey", "at");
CREATE UNIQUE INDEX "provider_call_stats_provider_bucket_key" ON "provider_call_stats"("provider", "bucket");
CREATE INDEX "provider_call_stats_bucket_idx" ON "provider_call_stats"("bucket");

ALTER TABLE "service_ledger_entries" ADD CONSTRAINT "service_ledger_entries_serviceKey_fkey" FOREIGN KEY ("serviceKey") REFERENCES "service_accounts"("key") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_settings" ADD COLUMN "opsAlertSmsTo" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN "opsAlertSmsFrom" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN "healthCheckAt" TIMESTAMP(3);
