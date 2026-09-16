-- Review UX: per-section toggles (template-level default + per-edition override).
ALTER TABLE "brand_settings" ADD COLUMN "nlSectionsDisabled" JSONB;
ALTER TABLE "newsletters" ADD COLUMN "sectionsDisabled" JSONB;
