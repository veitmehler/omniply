-- AI Employee dashboard review metrics: review-request webhook counter +
-- daily Google review-count snapshots (growth baseline).
CREATE TABLE "review_request_events" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_request_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_request_events_accountId_createdAt_idx" ON "review_request_events"("accountId", "createdAt");

ALTER TABLE "review_request_events" ADD CONSTRAINT "review_request_events_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "review_count_snapshots" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "rating" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_count_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "review_count_snapshots_accountId_day_key" ON "review_count_snapshots"("accountId", "day");

ALTER TABLE "review_count_snapshots" ADD CONSTRAINT "review_count_snapshots_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
