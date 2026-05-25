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

## Models (V1 enabled)

- **Image**: gpt-image-2, nano-banana-pro/2, seedream-4.5/5.0, grok-imagine, midjourney-v8/niji-7
- **Video** (all async): kling-2.6/3.0, grok-video, seedance-2.0/-fast, veo-3.1/-lite, luma-uni-1
- **Text**: gemini-3-flash, gemini-3.1-pro, gpt-5.4-pro, qwen-3-6-plus
- **Audio**: grok-tts (sync), elevenlabs-tts-v3/music/sfx (async)

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
