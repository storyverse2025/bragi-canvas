# Storyverse Router (Server)

V1 router that wraps multiple AI providers behind a unified set of OpenAI-compatible endpoints. See [design spec](https://github.com/...) — or the local copy under `canvas/2026-05-25-storyverse-router-v1-design.md` — for design rationale.

## Run locally

```bash
cp .env.example .env
# fill in BRAGI_TOKENS, ASSET_SIGNING_SECRET, and provider keys
pnpm install
pnpm dev
# open http://localhost:8787/docs for OpenAPI / Swagger UI
```

## Test

```bash
pnpm test          # CI unit tests (mocked HTTP via nock)
pnpm smoke         # live smoke against all configured providers
pnpm smoke gpt-image-2  # one model only
pnpm smoke --capability=image  # all image models
```

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET  | `/v1/health` | public |
| POST | `/v1/auth/check` | verify svsk- token |
| POST | `/v1/uploads` | multipart reference upload |
| GET  | `/v1/assets/:id` | signed-URL serve (no auth) |
| POST | `/v1/chat/completions` | OpenAI-compatible chat |
| POST | `/v1/images/generations` | OpenAI-compatible images + ext |
| POST | `/v1/videos/generations` | always async |
| POST | `/v1/audio/speech` | OpenAI-compatible TTS |
| POST | `/v1/audio/music` | async |
| POST | `/v1/audio/sfx` | async |
| GET  | `/v1/tasks/:provider/:task_id` | async task poll |
| GET  | `/v1/openapi.json` | auto-generated spec |
| GET  | `/docs` | Swagger UI |

## Model operational status (V1, as of 2026-05-27)

Verified live on sv-dev. Re-run `pnpm smoke` after any provider account change.

| Model | Provider | Status |
|---|---|---|
| qwen-3-6-plus | tokenrouter | ✅ Working |
| gpt-5.4-pro | tokenrouter | ✅ Working |
| gemini-3.1-pro | tokenrouter | ✅ Working |
| gemini-3-flash | tokenrouter | ✅ Working (not separately tested; same path) |
| grok-imagine | xai | ✅ Working |
| gpt-image-2 | apimart | ✅ Working (async, poll /v1/tasks/apimart/{id}) |
| seedream-4.5 | byteplus | ✅ Working (t2i); i2i: signed URL fix applied 2026-05-27 |
| seedream-5.0 | byteplus | ✅ Working (t2i); i2i: signed URL fix applied 2026-05-27 |
| seedance-2.0 | tokenrouter (default), byteplus (override) | ✅ Working — both verified |
| seedance-2.0-fast | tokenrouter (default), byteplus (override) | ✅ tokenrouter (same path); byteplus verified separately |
| grok-video | xai | ✅ Working |
| luma-uni-1 | luma | ✅ Assumed working (not re-tested this cycle) |
| veo-3.1 | gemini | 🔴 Requires paid Gemini credits / allowlist |
| veo-3.1-lite | gemini | 🔴 Requires paid Gemini credits / allowlist |
| nano-banana-pro | apimart | ✅ Working (apimart: gemini-3-pro-image-preview; revived from fal balance block) |
| nano-banana-2 | apimart | ✅ Working (apimart: gemini-3.1-flash-image-preview; revived from fal balance block) |
| kling-2.6 | fal | 🔴 fal.ai balance exhausted — top up at fal.ai/dashboard/billing |
| kling-3.0 | fal | 🔴 fal.ai balance exhausted — top up at fal.ai/dashboard/billing |
| elevenlabs-tts-v3 | fal | 🔴 fal.ai balance exhausted — top up at fal.ai/dashboard/billing |
| elevenlabs-music | fal | 🔴 fal.ai balance exhausted — top up at fal.ai/dashboard/billing |
| elevenlabs-sfx | fal | 🔴 fal.ai balance exhausted — top up at fal.ai/dashboard/billing |
| grok-tts | xai | 🔴 xAI TTS not authorized on this API key |
| midjourney-v8 | legnext | ⏸️ Returns 501 Not Implemented in V1 |
| midjourney-niji-7 | legnext | ⏸️ Returns 501 Not Implemented in V1 |

**fal.ai models (kling, elevenlabs via fal)**: All return `400 User is locked. Reason: Exhausted balance.`
This is a **billing/account issue, not a code bug**. The models are implemented correctly and will resume
working once the fal.ai account is topped up at [fal.ai/dashboard/billing](https://fal.ai/dashboard/billing).
Do NOT remove these models from the registry — they'll work again after top-up.

**nano-banana models**: Switched to apimart (gemini-3-pro-image-preview / gemini-3.1-flash-image-preview).
fal remains available as override (`"provider": "fal"`) for when fal.ai balance is restored.

**Provider override**: for models with multiple providers (seedance), pass `"provider": "byteplus"` in the request body to force the fallback.

## Models (V1 enabled)

- **Image**: gpt-image-2 (apimart), nano-banana-pro/2 (apimart), seedream-4.5/5.0, grok-imagine, midjourney-v8/niji-7
- **Video** (all async): kling-2.6/3.0 (fal), grok-video, seedance-2.0/-fast (tokenrouter default), veo-3.1/-lite, luma-uni-1
- **Text**: gemini-3-flash, gemini-3.1-pro, gpt-5.4-pro, qwen-3-6-plus (all via tokenrouter)
- **Audio**: grok-tts (sync, xai), elevenlabs-tts-v3/music/sfx (async, fal)

## Architecture

```
src/
├── env.ts                Zod-validated env loader
├── auth.ts               svsk- allowlist middleware
├── errors.ts             6 normalized error codes
├── registry.ts           model → {provider, capability, async}
├── assets.ts             HMAC URL signing + tmp storage
├── schemas/              one Zod discriminatedUnion per endpoint
├── adapters/             per-provider HTTP wrappers
├── routes/               Hono route handlers using @hono/zod-openapi
└── index.ts              app entry
```

## Deploy

See `../deploy/deploy.sh`. Target: sv-dev (35.168.148.47), Ubuntu, systemd + Caddy reverse proxy.
