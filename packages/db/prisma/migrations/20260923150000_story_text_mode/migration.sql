-- Story-slide text color preset: brand-wide default for tinted story slides.
ALTER TABLE "brand_settings" ADD COLUMN "storyTextMode" TEXT NOT NULL DEFAULT 'auto';
