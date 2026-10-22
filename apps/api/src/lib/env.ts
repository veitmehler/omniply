/**
 * Deploy-environment detection (2026-10-22). NODE_ENV is 'production' on
 * BOTH droplets, so the distinguisher is SENTRY_ENVIRONMENT ('staging' /
 * 'production', set in both compose files), with the API_PUBLIC_URL
 * staging- prefix as the belt. Used to env-tag failure alerts and to keep
 * side-effectful crons (real SMS sends) off staging.
 */
export function deployEnvironment(): string {
  const sentry = process.env.SENTRY_ENVIRONMENT
  if (sentry) return sentry
  if ((process.env.API_PUBLIC_URL ?? '').includes('staging')) return 'staging'
  return 'production'
}

export function isProductionEnv(): boolean {
  return deployEnvironment() === 'production'
}
