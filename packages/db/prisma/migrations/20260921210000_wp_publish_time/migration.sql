-- WordPress publish time of day (clinic timezone), used when scheduling
-- approved articles on WP by their nominal date.
ALTER TABLE "settings" ADD COLUMN "wpPublishTime" TEXT NOT NULL DEFAULT '09:00';
