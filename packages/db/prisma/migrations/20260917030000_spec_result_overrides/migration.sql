-- Per-post recompose overrides (text mode, slide text, slide images).
ALTER TABLE "social_automation_spec_results" ADD COLUMN "overridesJson" JSONB;
