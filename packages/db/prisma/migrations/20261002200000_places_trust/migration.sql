-- Places trust (.plans/places-trust.implementation-plan.md): place-ID
-- provenance + explicit listing confirmation, and review provenance so a
-- mis-resolved listing's harvested reviews can be purged by place.
ALTER TABLE "brand_settings" ADD COLUMN "googlePlaceIdSource" TEXT;
ALTER TABLE "brand_settings" ADD COLUMN "googleListingConfirmedAt" TIMESTAMP(3);
ALTER TABLE "raw_reviews" ADD COLUMN "sourcePlaceId" TEXT;
