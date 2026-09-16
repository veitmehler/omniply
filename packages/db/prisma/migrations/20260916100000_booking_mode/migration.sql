-- Phone-only booking mode (run-3 item 8): 'online' | 'phone'; NULL = legacy online-with-url.
ALTER TABLE "brand_settings" ADD COLUMN "bookingMode" TEXT;
