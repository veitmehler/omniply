-- LeadGenTemplate vertical dimension (wellness plan Phase 3): masters are
-- compiled per account at onboarding, so each template declares which
-- vertical owns it ('chiro' | 'wellness' | 'all').
ALTER TABLE "leadgen_templates" ADD COLUMN "vertical" TEXT NOT NULL DEFAULT 'chiro';
