<?php
/**
 * Plugin Name: Omniply Connect
 * Description: Prints the structured-data (JSON-LD) block managed by your Omniply marketing platform in the site head, and optionally embeds your Omniply chat widget. The widget script loads only from the fixed omniply.io domain and only after a widget token has been configured; the JSON-LD path executes no remote code.
 * Version:     1.1.0
 * Requires at least: 5.5
 * Requires PHP: 7.4
 * Author:      Omniply
 * Author URI:  https://omniply.io
 * License:     GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: omniply-connect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OMNIPLY_CONNECT_OPTION', 'omniply_head_jsonld' );
define( 'OMNIPLY_CONNECT_WIDGET_OPTION', 'omniply_widget_token' );

/**
 * The chat-widget loader URL is a fixed constant, never derived from stored
 * data: the token option can select WHICH clinic's widget loads, but can never
 * point the script anywhere other than the Omniply platform.
 */
define( 'OMNIPLY_CONNECT_WIDGET_SRC', 'https://svc.omniply.io/api/agent/widget.js?v=4' );

/**
 * Echo the stored JSON-LD in wp_head. The option is stored as a JSON string of
 * an ARRAY of schema objects; it is re-validated on output so nothing that is
 * not valid JSON can ever reach the page.
 */
function omniply_connect_print_head() {
	$raw = get_option( OMNIPLY_CONNECT_OPTION, '' );
	if ( ! is_string( $raw ) || '' === trim( $raw ) ) {
		return;
	}
	$decoded = json_decode( $raw, true );
	if ( null === $decoded || ! is_array( $decoded ) ) {
		return;
	}
	// Re-encode from the decoded structure: output is guaranteed pure JSON.
	// (PHP 7.4-safe list check — array_is_list() is 8.1+.)
	$is_list = array_keys( $decoded ) === range( 0, count( $decoded ) - 1 );
	echo "\n<!-- Omniply Connect -->\n";
	foreach ( ( $is_list ? $decoded : array( $decoded ) ) as $schema ) {
		if ( ! is_array( $schema ) ) {
			continue;
		}
		echo '<script type="application/ld+json">' . wp_json_encode( $schema ) . "</script>\n";
	}
	echo "<!-- /Omniply Connect -->\n";
}
add_action( 'wp_head', 'omniply_connect_print_head', 20 );

/**
 * Validate a widget token: the exact character class and length the platform
 * mints. Anything else is rejected and never printed.
 */
function omniply_connect_valid_widget_token( $token ) {
	return is_string( $token ) && 1 === preg_match( '/^[A-Za-z0-9_-]{16,64}$/', $token );
}

/**
 * Echo the chat-widget loader in wp_footer when (and only when) a valid token
 * is stored. The script src is the fixed OMNIPLY_CONNECT_WIDGET_SRC constant;
 * the token rides on a data attribute. Empty option = no output at all.
 */
function omniply_connect_print_widget() {
	$token = get_option( OMNIPLY_CONNECT_WIDGET_OPTION, '' );
	if ( ! omniply_connect_valid_widget_token( $token ) ) {
		return;
	}
	echo "\n" . '<script async src="' . esc_url( OMNIPLY_CONNECT_WIDGET_SRC ) . '" data-omniply="' . esc_attr( $token ) . '"></script>' . "\n";
}
add_action( 'wp_footer', 'omniply_connect_print_widget', 20 );

/**
 * REST route so the connected platform can update the block with the site's
 * existing Application Password credentials. Requires manage_options.
 */
function omniply_connect_register_routes() {
	register_rest_route(
		'omniply/v1',
		'/head',
		array(
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => function ( WP_REST_Request $request ) {
					$jsonld = $request->get_param( 'jsonld' );
					if ( null === $jsonld || '' === $jsonld ) {
						delete_option( OMNIPLY_CONNECT_OPTION );
						return rest_ensure_response( array( 'cleared' => true ) );
					}
					if ( ! is_string( $jsonld ) ) {
						$jsonld = wp_json_encode( $jsonld );
					}
					$decoded = json_decode( $jsonld, true );
					if ( null === $decoded || ! is_array( $decoded ) ) {
						return new WP_Error( 'omniply_invalid_json', 'jsonld must be valid JSON (object or array of objects).', array( 'status' => 400 ) );
					}
					if ( strlen( $jsonld ) > 65535 ) {
						return new WP_Error( 'omniply_too_large', 'jsonld exceeds 64KB.', array( 'status' => 400 ) );
					}
					update_option( OMNIPLY_CONNECT_OPTION, wp_json_encode( $decoded ), false );
					return rest_ensure_response( array( 'saved' => true ) );
				},
			),
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => function () {
					return rest_ensure_response( array( 'jsonld' => get_option( OMNIPLY_CONNECT_OPTION, '' ) ) );
				},
			),
		)
	);

	register_rest_route(
		'omniply/v1',
		'/widget',
		array(
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => function ( WP_REST_Request $request ) {
					$token = $request->get_param( 'token' );
					if ( null === $token || '' === $token ) {
						delete_option( OMNIPLY_CONNECT_WIDGET_OPTION );
						return rest_ensure_response( array( 'cleared' => true ) );
					}
					if ( ! omniply_connect_valid_widget_token( $token ) ) {
						return new WP_Error( 'omniply_invalid_token', 'token must match [A-Za-z0-9_-]{16,64}.', array( 'status' => 400 ) );
					}
					update_option( OMNIPLY_CONNECT_WIDGET_OPTION, $token, false );
					return rest_ensure_response( array( 'saved' => true ) );
				},
			),
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => function () {
					return rest_ensure_response( array( 'token' => get_option( OMNIPLY_CONNECT_WIDGET_OPTION, '' ) ) );
				},
			),
		)
	);
}
add_action( 'rest_api_init', 'omniply_connect_register_routes' );
