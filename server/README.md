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

**17/24 working · 1 works-but-slow · 4 account-gated · 2 deferred to V2.**

| Model | Provider | Status |
|---|---|---|
| qwen-3-6-plus | tokenrouter | ✅ Working |
| gpt-5.5-pro | tokenrouter | ✅ Working (upstream openai/gpt-5.5) |
| gemini-3-flash | tokenrouter | ✅ Working |
| gemini-3.1-pro | tokenrouter | ✅ Working |
| grok-imagine | xai (native) | ✅ Working |
| gpt-image-2 | apimart | ✅ Working (async, poll /v1/tasks/apimart/{id}) |
| nano-banana-pro | apimart | ✅ Working (gemini-3-pro-image-preview) |
| nano-banana-2 | apimart | ✅ Working (gemini-3.1-flash-image-preview) |
| seedream-4.5 | byteplus (北京区) | ✅ Working (t2i + i2i signed-URL) |
| seedream-5.0 | byteplus (北京区) | ✅ Working (t2i + i2i signed-URL) |
| seedance-2.0 | tokenrouter (byteplus override) | ✅ Working (OpenAI Videos API) |
| seedance-2.0-fast | tokenrouter (byteplus override) | ✅ Working |
| kling-2.6 | fal | ✅ Working |
| kling-3.0 | fal | ✅ Working |
| elevenlabs-sfx | elevenlabs (native) | ✅ Working (direct /v1/sound-generation) |
| elevenlabs-tts-v3 | elevenlabs (native) | ✅ Working (direct /v1/text-to-speech; voice-name→id mapping) |
| elevenlabs-music | elevenlabs (native) | ✅ Working (direct /v1/music, paid plan) |
| grok-video | xai (native) | 🟡 Works but slow (xAI i2v >15min; avoid time-sensitive demos) |
| veo-3.1 | gemini | 🔴 Gemini credits depleted — top up Google AI billing |
| veo-3.1-lite | gemini | 🔴 Gemini credits depleted |
| luma-uni-1 | luma | 🔴 Luma proxy token not authenticated; no team video reference impl |
| grok-tts | xai (native) | 🔴 xAI account not authorized for TTS (code ready) |
| midjourney-v8 | legnext | ⏸️ Returns 501 in V1 (Legnext vendor integration deferred to V2) |
| midjourney-niji-7 | legnext | ⏸️ Returns 501 in V1 |

**ElevenLabs (sfx / tts-v3 / music)**: all on native ElevenLabs direct (paid key). TTS resolves friendly voice names (adam, rachel, …) and OpenAI-style aliases (alloy, echo, …) to ElevenLabs voice_ids; unknown voices fall back to Adam.

**Provider override**: for models with multiple providers (nano-banana: apimart↔fal; seedance: tokenrouter↔byteplus; elevenlabs: elevenlabs↔fal), pass `"provider": "<name>"` in the request body. Invalid combos return 400 listing valid options.

**Remaining blockers**: veo (Gemini credits), luma-uni-1 (token + no video impl), grok-tts (xAI TTS permission), midjourney (V2 vendor), grok-video (slow). All are account/vendor issues, not code bugs.

## Models (V1 enabled)

- **Image**: gpt-image-2 (apimart), nano-banana-pro/2 (apimart), seedream-4.5/5.0, grok-imagine, midjourney-v8/niji-7
- **Video** (all async): kling-2.6/3.0 (fal), grok-video, seedance-2.0/-fast (tokenrouter default), veo-3.1/-lite, luma-uni-1
- **Text**: gemini-3-flash, gemini-3.1-pro, gpt-5.5-pro, qwen-3-6-plus (all via tokenrouter)
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
