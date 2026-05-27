/**
 * Vitest global setup — provides safe default env vars so that
 * `pnpm test` works from a clean checkout without any .env file.
 *
 * Uses `??=` so that values already set in the environment (e.g. CI) win.
 */
process.env.ROUTER_PUBLIC_URL ??= 'https://router.test'
process.env.ASSET_SIGNING_SECRET ??= '0123456789abcdef0123456789abcdef'
process.env.BRAGI_TOKENS ??= 'svsk-test-1,svsk-test-2'
process.env.ASSET_TMP_DIR ??= './tmp-test'
