<?php
// Clean up the stored options on uninstall.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}
delete_option( 'omniply_head_jsonld' );
delete_option( 'omniply_widget_token' );
