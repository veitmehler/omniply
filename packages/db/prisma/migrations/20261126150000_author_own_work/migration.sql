-- What the author does with patients or clients personally, and what others on
-- the team do (author-voice plan, 2026-11-26). Articles are written in the first
-- person as the author; this keeps them from claiming a colleague's work.
ALTER TABLE "brand_settings" ADD COLUMN IF NOT EXISTS "defaultAuthorOwnWork" TEXT;
