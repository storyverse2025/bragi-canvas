# V2 Cloud Mode — feature gaps & follow-up PRs

V1 Cloud Mode (PR #3) prioritized "main generation path works end-to-end" over
"every UI control transparently flows through the router." The result: a number
of UI controls and modes that **work in Local Mode** are hidden in Cloud Mode
because the V1 router schema doesn't carry them yet. None of these are upstream
API limitations — they're all schema simplifications in `server/src/schemas/*`
that V2 can close. (A handful are real upstream limits and called out below as
"won't fix".)

This file is the canonical V2 todo. When opening a follow-up PR, link it here.

## How V1 currently handles the gap

For each cloud-unsupported control:
- The plugin model definition flags it (`ModelParam.unsupportedInCloud: true`
  for params; `ModelConfig.unsupportedCloudModes: Mode[]` for modes).
- `src/panel.ts` hides the control from the UI in Cloud Mode (`rebuildParams`,
  `rebuildModeList`, `voiceConfigFor`).
- `src/providers/storyverse.ts` throws defensively if a non-panel caller (MCP,
  scripts) sends the field anyway (`refuseCloudUnsupportedParams` + per-model
  guards).
- Integration tests assert anti-drift so adding new model+param doesn't silently
  reintroduce a hidden silent-drop.

V2 PRs should:
1. Implement the field in `server/src/schemas/*.ts` (and the adapter).
2. Wire `src/providers/storyverse.ts` to forward the value.
3. Remove the corresponding `unsupportedInCloud` / `unsupportedCloudModes` flag.
4. Delete the now-stale integration test assertions (the invariants will
   automatically stop tripping once the flags are gone).

---

## Video — modes

| Model | Hidden modes in Cloud V1 | Upstream API supports it? | Notes |
|---|---|---|---|
| `veo-3.1` | `first-frame`, `first-last-frame`, `image-ref` | ✅ Gemini Veo API has first-frame + last-frame fields | Add `input_assets: z.array(z.string()).max(2).optional()` to veo schema; adapter maps `input_assets[0]` → first frame, `[1]` → last frame |
| `veo-3.1-lite` | `first-frame` | ✅ same | Same schema/adapter change as veo-3.1 |
| `grok-video` | `text-to-video`, `video-extend` | ✅ xAI grok-video supports text-to-video; video-extend uses reference video | Drop schema `min(1)` on `input_assets`; for video-extend, router needs to accept video refs (new field, not just images) |
| `seedance-2.0`, `seedance-2.0-fast` | `video-ref` | ✅ byteplus seedance supports video refs | Add video-ref upload support to `/v1/uploads` (or accept video data URIs in `input_assets`); adapter forwards the video to byteplus |

## Video — parameters

| Model | Hidden params | Upstream | Notes |
|---|---|---|---|
| `veo-3.1`, `veo-3.1-lite` | `durationSeconds` (4/6/8), `resolution` (720p/1080p) | ✅ Gemini Veo accepts both | Add to schema + adapter |
| `grok-video` | `duration` (5/10/15), `aspect_ratio`, `resolution` | ✅ xAI supports all three | Schema currently locks `duration: '6'` — open enum + add fields |
| `seedance-2.0`, `seedance-2.0-fast` | `resolution` (480p/720p/1080p) | ✅ byteplus supports | Add to schema + adapter |
| `kling-2.6`, `kling-3.0` | `mode` (Standard/Pro) | ✅ kling supports mode/quality tier | Add to schema; fal adapter routes pro vs std to different endpoints/parameters |

## Image — parameters

| Model | Hidden params | Upstream | Notes |
|---|---|---|---|
| `nano-banana-pro`, `nano-banana-2` | `imageSize` (1K/2K/4K, 512 for nb-2) | ✅ Gemini Imagen supports size | Add `imageSize` to schema; apimart adapter forwards |
| `seedream-4.5`, `seedream-5.0` | `resolution` (2K/3K, 4K for sd-4.5) | ✅ byteplus supports | Same |
| `midjourney-v8`, `midjourney-niji-7` | `ar` (extended aspect ratios), `stylize` | ✅ Midjourney natively supports these | Add to schema; legnext adapter forwards |
| `gpt-image-2` | `imageSize` (2K/4K), `quality` (low/medium/high) | ⚠️ Mixed — see "Won't fix" | OpenAI gpt-image-2 only supports `size ∈ {1024x1024, 1792x1024, 1024x1792}` and has no `quality`. Plugin Local Mode's 2K/4K + quality are borrowed from fal's wrapper. Cloud V2 could plumb size via fal (a fallback provider for gpt-image-2), but not via OpenAI direct. |

## Audio — parameters

| Model | Hidden params | Upstream | Notes |
|---|---|---|---|
| `elevenlabs-tts-v3` | `stability`, `similarity_boost`, `style` | ✅ ElevenLabs API accepts all three (`voice_settings`) | Add to schema; elevenlabs adapter forwards into `voice_settings` |
| `grok-tts` | `language` | ✅ xAI grok-tts accepts language code | Add to schema |

## Audio — voice clone / voice design

| Model | Hidden source | Upstream | Notes |
|---|---|---|---|
| `elevenlabs-tts-v3` | `reference` (voice clone), `design` (voice design) | ✅ ElevenLabs has both endpoints | New router endpoints: `POST /v1/audio/voice-clone` (multipart audio → voice_id) and `POST /v1/audio/voice-design` (text prompt → voice_id). Then `StoryverseAudioProvider` implements `cloneVoice` + `designVoice` methods. Then remove the cloud-mode override in `voiceConfigFor` |

## Text — multimodal inputs

| Model | Hidden input kinds | Upstream | Notes |
|---|---|---|---|
| All router text models (`gemini-3-flash`, `gemini-3.1-pro`, `qwen-3-6-plus`) | image, PDF, video, audio attachments | ✅ Gemini + Qwen all support multimodal | Router `/v1/chat/completions` schema is currently `messages[].content: string`. Needs to accept multimodal content (`{ type: 'image' \| 'text', ... }[]`), pass through to tokenrouter/upstream. Plugin already extracts refs and would just need to forward them. `gpt-5.5-pro` text via OpenAI doesn't have multimodal — partial |

## Security follow-ups

| Issue | Where | V2 plan |
|---|---|---|
| `BUILTIN_BRAGI_RELAY.token` hardcoded in client | `src/providers/bragi-relay.ts` (predates Cloud Mode) | Move all ref uploads to router's `/v1/uploads` (already used by Cloud Mode) and retire the temp.bragi.now public-anonymous worker; or issue per-request short-lived tokens server-side |
| `bragiToken` + provider API keys stored plaintext in `data.json` | Obsidian plugin storage convention | Encrypt at rest (OS keychain or libsodium with vault-bound key); document in plugin settings |
| `console.error(prefix, err)` in `main.ts` logs raw Error objects to DevTools console | 9 sites in `main.ts` | Wrap Notice + console.error in a `safeReport(err)` helper that runs `sanitizeRouterMessage` on the message. Router-origin errors are already sanitized at throw time, but non-router errors (network, plugin's own preconditions) can carry URLs/paths. Devtools-opened users only; no tokens (those live in headers, not Error.message) |

## Observability follow-ups

| Issue | Where | V2 plan |
|---|---|---|
| No router access log | `server/src/index.ts` | Add `@hono/logger` middleware: `<ts> <method> <path> <model> <status> <duration_ms>`. tcpdump on `lo:8787` is currently the only diagnostic |
| No trace ID echoed in errors | `server/src/errors.ts` | Generate request_id at the auth middleware, include in `error.request_id`. Plugin surfaces it in the user-facing Notice for support reports |
| No router health-by-provider metric | n/a | Track per-provider success / failure / latency in memory; expose at `GET /v1/health` for monitoring |

## Known prior bugs (predate PR #3 but related)

- `grok-video` plugin default `duration: '5'` but server schema enum is locked to `'6'`. Local Mode is unaffected (Local xai provider sends what plugin says, xAI then 422s or whatever — but that's the same on its own with or without Cloud Mode). Once V2 opens the duration enum on the server, plugin default lines up.
- Plugin model defaults for `gpt-image-2` (`imageSize: '2K'`) and similar exceed what OpenAI direct can serve. V2 may want a Cloud-aware `cloudDefault?` on ModelParam, or document that Cloud's default behavior is "API-direct minimum (1024)".
- `server/scripts/smoke.ts` typed-eslint parser config is broken (`npm run lint:obsidian` fails). Unrelated to Cloud Mode; fix in any cleanup PR.

## Suggested V2 PR breakdown

To keep V2 PRs reviewable, split by surface area rather than by feature:

1. **`feat(server): video schemas — implement input_assets / duration / resolution for Veo + grok-video + seedance`** — biggest impact, all upstream APIs support it
2. **`feat(server): image schemas — pass through size/resolution/ar/stylize for nano-banana/seedream/midjourney`** — straightforward parameter forwarding
3. **`feat(server): audio voice_settings — pass stability/similarity_boost/style for elevenlabs-tts-v3, language for grok-tts`** — small but high-visibility
4. **`feat(server): voice-clone + voice-design endpoints + plugin StoryverseAudioProvider`** — bigger, depends on ElevenLabs adapter work
5. **`feat(server): multimodal /v1/chat/completions`** — schema reshape, plugin already has refs ready
6. **`feat(server): access log middleware + request_id`** — observability sweep
7. **`refactor(plugin): replace BUILTIN_BRAGI_RELAY with router /v1/uploads`** — security
8. **`feat(plugin): encrypt-at-rest for bragiToken + provider keys`** — security

Each V2 PR should remove the relevant `unsupportedInCloud` / `unsupportedCloudModes` flags as the last step, so the integration invariant tests automatically validate the new coverage.
