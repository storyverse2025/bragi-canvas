/**
 * task-id — base64url encode/decode for provider task IDs.
 *
 * Provider-internal task IDs may contain URL-unsafe characters (e.g. `/`
 * in fal composite IDs like "fal-ai/kling-video/v3/text-to-video|req-abc").
 * We expose only opaque, base64url-encoded IDs on the public API boundary so
 * that the poll route `/v1/tasks/:provider/:task_id` always receives a
 * single safe path segment.
 *
 * Adapters continue to return their natural raw IDs.  Encoding/decoding
 * happens exclusively at the route layer (not inside adapters).
 */

/**
 * Encode a raw provider task ID to a URL-safe base64url string.
 * Safe strings (e.g. plain "task_xxx") round-trip correctly.
 */
export function encodeTaskId(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url')
}

/**
 * Decode a base64url task ID back to the raw provider value.
 * Throws if the input is not valid base64url (callers should treat as 400).
 */
export function decodeTaskId(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf8')
}
