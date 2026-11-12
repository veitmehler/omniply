-- DM responder per-channel reply modes (2026-11-12): { whatsapp, instagram,
-- facebook } each 'off' | 'inquiries' | 'all'. NULL = defaults (WhatsApp all,
-- Instagram/Facebook inquiries only) — see apps/api/src/agent/dm-gate.ts.
ALTER TABLE "accounts" ADD COLUMN "dmChannelModes" JSONB;
