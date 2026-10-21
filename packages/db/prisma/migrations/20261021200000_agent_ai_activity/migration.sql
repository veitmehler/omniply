-- AI Activity dashboard backbone (snapshot-optimization plan): the three
-- facts the finalize-time rollup cannot reconstruct after the fact.
ALTER TABLE "agent_conversations" ADD COLUMN "dmPlatform" TEXT;
ALTER TABLE "agent_conversations" ADD COLUMN "contactWasCreated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "agent_conversations" ADD COLUMN "startedAfterHours" BOOLEAN;
