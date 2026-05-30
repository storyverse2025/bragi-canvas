# V2 Storyverse Router — feature gaps & follow-up PRs

> **2026-05-29 update — PR #3 architectural refactor.** R1-R7 added a plugin-side
> "Cloud Mode" abstraction (a `generationMode` toggle, `unsupportedInCloud` /
> `unsupportedCloudModes` flags, a `cloud-overrides.ts` helper, hide-and-refuse
> logic across panel.ts + mcp-tool-registry.ts + storyverse.ts). Simon's review
> pointed out the right shape: Storyverse is just an AI gateway like
> tokenrouter/fal — the plugin should know nothing about its schema beyond
> "this provider supports these model ids." We reverted the abstraction:
> Storyverse is now a standard multi-field `ProviderSpec` and per-model schema
> drift is server-side only.
>
> The follow-ups below are still valid as a server-side roadmap (which router
> schemas to extend). Until V3 makes the router manifest the catalog source of
> truth, the plugin hides Storyverse-only no-op params/modes listed in
> `src/providers/storyverse.ts` and `src/providers/storyverse.ts` forwards only
> fields implemented by the router.

V1 Storyverse (PR #3) prioritized "main generation path works end-to-end" over
"every UI control transparently flows through the router." A number of UI
controls and modes that **work via other providers** silently 400 if the user
selects Storyverse for that model. None of these are upstream API limitations —
they're all schema simplifications in `server/src/schemas/*` that V2 can close.
(A handful are real upstream limits and called out below as "won't fix".)

This file is the canonical V2 todo. When opening a follow-up PR, link it here.

## How V1 currently handles the gap

After the R9/R10 cleanup: Storyverse-only no-op params and unsupported modes
are hidden in the panel and omitted from MCP `list_models`; MCP `generate`
rejects caller-supplied off-surface params/modes. The remaining client-side
throws are the few cases where letting the request reach the router would 400
with a worse error (Veo `refImages` with no input_assets schema; grok-video
text-to-video with no input_assets; ref-count overflow per model).

V2 PRs should:
1. Implement the field in `server/src/schemas/*.ts` (and the adapter).
2. Wire `src/providers/storyverse.ts` `buildBody` to forward the value.
3. Remove the field/mode from `STORYVERSE_NOOP_PARAMS` or `STORYVERSE_UNSUPPORTED_MODES`.

## Per-model parameters that are no-op via Storyverse today

When the panel routes through Storyverse, these UI controls are hidden because
the model file declares them for other providers but Storyverse V1 does not
forward them. V2 closes each by extending the server schema + adapter, updating
`buildBody` to forward the value, and removing the corresponding hide rule.

| Model | No-op params via Storyverse | V2 server work |
|---|---|---|
| `nano-banana-pro`, `nano-banana-2` | `imageSize` | Add to `images-generations` schema + apimart adapter |
| `seedream-4.5`, `seedream-5.0` | `resolution` | Add to schema + byteplus adapter |
| `gpt-image-2` | `imageSize`, `quality` | Mixed — OpenAI direct only takes `size`; quality came from fal. Cloud V2 could plumb via fal fallback |
| `grok-imagine` | `quality` (Normal vs Quality tier) | xAI adapter must accept the quality flag |
| `veo-3.1`, `veo-3.1-lite` | `durationSeconds`, `resolution` | Add to Veo schema + adapter |
| `grok-video` | `duration`, `aspect_ratio`, `resolution` | Drop hardcoded `duration: '6'`; open enums |
| `seedance-2.0`, `seedance-2.0-fast` | `resolution` | Add to schema + byteplus adapter |
| `kling-2.6`, `kling-3.0` | `mode` (Standard vs Pro) | Add to schema; fal adapter routes pro/std |
| `elevenlabs-tts-v3` | `stability`, `similarity_boost`, `style`, `speed` | Add to `/v1/audio/speech` schema |
| `grok-tts` | `language` (xAI auto-detection control) | Add to schema |
| `elevenlabs-music`, `elevenlabs-sfx` | duration controls past current `duration_ms` floor/ceiling | Extend per-model min/max in schema |

A few **defensive throws** remain in `storyverse.ts` for cases where the silent
drop is genuinely user-hostile (router would either 400 with a worse error, or
return a result wildly unrelated to what the user asked for):
- `gpt-image-2`: aspect ratios outside `{1:1, 16:9, 9:16}` throw (otherwise silently mapped to 1024×1024 square).
- `grok-imagine`: any `refImages` throws (V1 router schema is text-to-image only; silent drop would render unrelated content).
- `grok-video`: missing `refImages` throws (V1 router schema requires `input_assets.min(1)`).
- `veo-3.1` / `veo-3.1-lite`: any `refImages` throws (V1 router Veo schema has no `input_assets`).
- Per-model ref-count overflow: `refuseTooManyRefs` enforces the router's `input_assets.max(N)` per model.

These are the only intentional client-side gates. Everything else lets the
router speak for itself.

## V3 — dynamic model manifest (full "AI Gateway" direction)

V1 + V2 keep the plugin's static model registry (`src/models/*.ts`) as the
canonical list — V2 just makes more router fields wired through. V3 is the
architectural step that eliminates the static list and makes the **server the
single source of truth** for the model catalog.

### Server contract (`GET /v1/models` manifest)

Per model:
- `id` — router-side model id
- `type` — `image | video | text | audio`
- `modes` — array of `'text-to-image' | 'image-ref-to-image' | 'first-frame' | 'text-to-video' | 'tts' | 'music' | …`
- `params` — array of `{ id, label, type: 'select'|'range'|'number', options?, default, min?, max?, step?, unit? }`
- `inputAssets` — per-mode `{ accepts: ('image'|'video'|'audio')[], min, max }`
- `textMultimodal` (text models only) — `{ kinds: ('image'|'pdf'|'video'|'audio')[], maxImages?, maxVideos?, maxAudios?, maxPdfs?, maxPdfBytes? }`
- `audioVoice` (audio TTS models only) — `{ builtin, clone, design }`
- `cost` — pricing metadata (cents per generation, token rates, …)
- `status` — `'available' | 'deprecated' | 'disabled'` (+ optional `deprecationMessage`)
- `manifestVersion` — integer for plugin-side compatibility checks

### Plugin changes

- `ALL_MODELS` in `src/models/index.ts` becomes `STATIC_MODELS` + dynamic merge
  with server-fetched manifest. Static list is the fallback when manifest is
  unreachable (so the plugin still works offline with whatever models it knew
  about last time).
- `getEnabledModels` accepts a mixed source: static + remote. Remote-only models
  render with `provider: storyverse` exclusively.
- Panel param UI (`rebuildParams` in `src/panel.ts`) renders from manifest
  schema instead of static `ModelConfig.params`.
- MCP `list_models` and `generate` (`src/mcp-tool-registry.ts`) consume the
  manifest for schema validation.
- `modelPrefs[id]` / `modelOrder[type]` / `lastSelection.modelId` migration when
  the server renames or deprecates a model.
- Offline cache: store last good manifest in `data.json` (`manifestFetchedAt`,
  `manifest`). On startup load cache first, refresh in background. If fetch
  fails on first install, fall back to `STATIC_MODELS` with a Notice.
- `manifestVersion` compatibility: plugin declares min version it understands;
  older server response → ignore + use static fallback + log. Newer is fine
  (forward-compatible — unknown fields ignored).
- Test coverage: panel UI rendering from synthetic manifest fixtures; MCP
  `list_models` shape; migration for deprecated/renamed models; offline cache
  fallback; manifest-fetch-fails-on-first-install fallback.

### What survives V3

- `ProviderSpec` registry pattern — storyverse stays a multi-field provider
  (URL + token).
- `StoryverseImageProvider/Video/Text/Audio` capability classes — still
  translate the generic generation call into router HTTP. They stop
  hard-coding model-id branches in `buildBody`; instead the manifest describes
  what fields to send.
- `migrateStoryverseProvider` — keeps running once for legacy
  `bragiCloudUrl`/`bragiToken` users.

### Why V3 (not V2)

V2 is scoped as "close the schema gaps for the existing 23 static-list models"
(extending Veo `input_assets`, grok-video `duration`, ElevenLabs Music length,
etc.). V3 eliminates the static list itself. They're independent — V2 lands as
its own PR sequence; V3 is the next architectural step after V2 closes the
obvious wire-level gaps.

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
| `/v1/auth/check` echoed the svsk- token in its response body as `label` | Fixed in PR #3 R10: `server/src/routes/auth.ts` returns `{ ok: true }` only | Keep regression test coverage in `server/test/routes/auth.test.ts`; do not reintroduce token-derived labels unless they are non-reversible |

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
9. **`fix(server): /v1/auth/check no longer echoes raw svsk- token`** — small standalone fix, drop or hash the `label` field (same shape as PR #2's rename, ~5 min)

Each V2 PR should remove the relevant `unsupportedInCloud` / `unsupportedCloudModes` flags as the last step, so the integration invariant tests automatically validate the new coverage.
