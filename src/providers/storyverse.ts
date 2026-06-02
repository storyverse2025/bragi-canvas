/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Router payloads are runtime-shaped data narrowed at use sites. */
import type { App, RequestUrlResponse } from 'obsidian'
import { requestUrl } from 'obsidian'
import type {
	ImageProvider, VideoProvider, AudioProvider,
	GenerateImageResult, GenerateVideoResult, GenerateAudioResult,
} from './types'
import type { TextGenProvider, TextGenResult } from './text-gen'
import { SYSTEM_PROMPT } from './text-gen'

/**
 * Storyverse Cloud provider — plugin client for the Bragi V1 router.
 *
 * In Cloud Mode every model routes through one router with a single `svsk-` token.
 * The router (its `registry.ts`) is the source of truth for which real provider
 * serves each model, so the plugin sends ONLY `model` (+ params), never a provider.
 *
 * Contract (frozen, see server/src + https://router.storyverseai.art/docs):
 *   - sync image/text  → 200 JSON
 *   - async image/video → 202 { task_id, provider, poll_after_ms, poll_url }, poll GET /v1/tasks/{provider}/{task_id}
 *   - audio speech → 200 raw bytes; music/sfx may be 200 bytes or 202 async
 *   - reference assets → POST /v1/uploads (field `file`) → asset_id, passed back as input_assets
 *   - errors → { status:'failed', error:{ code, message } }
 */

const POLL_TIMEOUT_MS = 5 * 60 * 1000   // give async image/audio up to 5 min inline
const DEFAULT_POLL_MS = 4000

// Router image/video schemas only accept `input_assets` for these models. For
// the rest (grok-imagine, midjourney-*, veo-*) the field doesn't exist in the
// schema, so uploading refs would be a wasted round-trip. Keep this set tight.
const IMAGE_MODELS_ACCEPTING_REFS = new Set([
	'gpt-image-2', 'nano-banana-pro', 'nano-banana-2', 'seedream-4.5', 'seedream-5.0',
])
const VIDEO_MODELS_ACCEPTING_REFS = new Set([
	'kling-2.6', 'kling-3.0', 'seedance-2.0', 'seedance-2.0-fast', 'grok-video',
])

/** Per-model max input_assets length the router schema allows. Provider truncates+throws above this. */
const INPUT_ASSETS_MAX: Record<string, number> = {
	'gpt-image-2': 1,
	'nano-banana-pro': 3,
	'nano-banana-2': 3,
	'seedream-4.5': 3,
	'seedream-5.0': 3,
	'kling-2.6': 2,
	'kling-3.0': 2,
	'seedance-2.0': 1,
	'seedance-2.0-fast': 1,
	'grok-video': 1,
}

/**
 * Per-model params declared in the plugin model file that the V1 router schema does NOT
 * forward to the upstream provider. The router's Zod schemas default to stripping unknown
 * fields, so omitting these from buildBody would mean the user's UI choice silently has
 * no effect.
 *
 * panel.ts + mcp-tool-registry.ts read this table and hide the params from the UI / MCP
 * surface when the active provider is storyverse, so the user never picks a value that
 * silently won't be used. storyverse.ts buildBody is the second line of defense — it
 * doesn't insert these field names into the request body either.
 *
 * When the V2 router PR adds a field to the schema + adapter, remove it here in the same
 * commit so the panel exposes it again.
 */
export const STORYVERSE_NOOP_PARAMS: Readonly<Record<string, readonly string[]>> = {
	'nano-banana-pro': ['imageSize'],
	'nano-banana-2': ['imageSize'],
	'seedream-4.5': ['resolution'],
	'seedream-5.0': ['resolution'],
	'gpt-image-2': ['imageSize', 'quality'],
	'grok-imagine': ['quality'],
	'veo-3.1': ['durationSeconds', 'resolution'],
	'veo-3.1-lite': ['durationSeconds', 'resolution'],
	'grok-video': ['duration', 'aspect_ratio', 'resolution'],   // duration is hard-locked to '6' in buildBody
	'seedance-2.0': ['resolution'],
	'seedance-2.0-fast': ['resolution'],
	'kling-2.6': ['mode'],
	'kling-3.0': ['mode'],
	'elevenlabs-tts-v3': ['stability', 'similarity_boost', 'style', 'speed'],
	'grok-tts': ['language'],
}

/**
 * Per-model modes the V1 router schema cannot serve. panel.ts + mcp-tool-registry.ts hide
 * these from the UI / MCP surface when the active provider is storyverse, so the user
 * doesn't pick a mode that would then trigger storyverse.ts buildBody's defensive throw
 * (or silently render unrelated content).
 *
 * The throws in buildBody remain as a second line of defense for non-panel callers.
 */
export const STORYVERSE_UNSUPPORTED_MODES: Readonly<Record<string, readonly string[]>> = {
	'grok-imagine': ['image-ref-to-image'],   // router schema is { prompt, aspectRatio } only
	'grok-video':   ['text-to-video', 'video-extend'],   // router schema requires input_assets.min(1)
	'veo-3.1':      ['first-frame', 'first-last-frame', 'image-ref'],   // router Veo schema has no input_assets
	'veo-3.1-lite': ['first-frame'],
	'seedance-2.0':      ['video-ref'],   // router /v1/uploads accepts only image; no video ref schema
	'seedance-2.0-fast': ['video-ref'],
}

/** Throw if more refs are attached than the router schema accepts for this model. */
function refuseTooManyRefs(modelId: string, refs: string[] | undefined): void {
	if (!refs || refs.length === 0) return
	const max = INPUT_ASSETS_MAX[modelId]
	if (max === undefined || refs.length <= max) return
	throw new Error(
		`Storyverse: ${modelId} accepts at most ${max} reference asset${max === 1 ? '' : 's'} ` +
		`(router schema limit); ${refs.length} attached. Detach extras or pick a different provider for this model.`,
	)
}

/**
 * Plugin grok-tts voice options use xAI-style names (eve/ara/leo/rex/sal); the
 * router accepts OpenAI-style names (alloy/echo/fable/onyx/nova/shimmer).
 * Map at the provider boundary so the rest of the plugin doesn't need to know
 * which provider is serving grok-tts.
 */
const GROK_TTS_VOICE_REMAP: Record<string, string> = {
	eve: 'nova',
	ara: 'shimmer',
	leo: 'onyx',
	rex: 'echo',
	sal: 'fable',
}
function remapGrokTtsVoice(plugin: string): string {
	return GROK_TTS_VOICE_REMAP[plugin] || 'alloy'
}

/**
 * Plugin midjourney quality is a cost-tier ('1' = standard, '4' = high-cost),
 * router enum is low/medium/high. Map at the provider boundary.
 */
function remapMidjourneyQuality(plugin: string): 'medium' | 'high' {
	return plugin === '4' ? 'high' : 'medium'
}

interface RouterOutput { kind?: string; url?: string; text?: string; mime_type?: string }

// ── small coercion helpers (panel sends select values as strings) ──
function str(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : (typeof v === 'number' || typeof v === 'boolean') ? String(v) : fallback
}
function num(v: unknown, fallback: number): number {
	const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
	return Number.isFinite(n) ? n : fallback
}
function bool(v: unknown, fallback = false): boolean {
	if (typeof v === 'boolean') return v
	if (typeof v === 'string') return v === 'true'
	return fallback
}
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, ms))
}

/**
 * Defang upstream router error messages before surfacing them to the user-facing
 * Notice: cap length, scrub URLs/host:port/file paths/token-shaped strings so any
 * internal endpoint / provider debug info that the router happens to echo back
 * can't leak through Cloud Mode. The error code (e.g. `provider_unavailable`)
 * is preserved separately so users still get a useful classification.
 */
function sanitizeRouterMessage(raw: unknown): string {
	// Only accept primitives — anything else is defensive `router error` to avoid
	// surfacing `[object Object]` to the user.
	const text = typeof raw === 'string' ? raw
		: typeof raw === 'number' || typeof raw === 'boolean' ? String(raw)
		: ''
	return text
		.replace(/https?:\/\/\S+/gi, '<url>')
		.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<host>')
		.replace(/\b\w+-[A-Za-z0-9]{16,}/g, '<token>')   // svsk-*, sk-*, etc.
		.replace(/\/(?:Users|home|opt|var|etc|tmp)\/[^\s)]+/g, '<path>')
		.slice(0, 200)
		|| 'router error'
}

/** OpenAI gpt-image-2 takes a pixel `size`, not an aspect ratio. Router only supports
 *  three sizes; any other ratio is refused up front so the user sees a clear error
 *  rather than a silently-wrong square. */
function aspectToSize(aspectRatio: unknown): string {
	const ar = str(aspectRatio, '1:1')
	switch (ar) {
		case '1:1':  return '1024x1024'
		case '16:9': return '1792x1024'
		case '9:16': return '1024x1792'
		default:
			throw new Error(
				`Storyverse: gpt-image-2 only supports 1:1 / 16:9 / 9:16 aspect ratios (router schema limit); ` +
				`got "${ar}". Pick a supported ratio or use a different provider for this model.`,
			)
	}
}

function extFromMime(mime: string, fallback: string): string {
	const m = mime.toLowerCase()
	if (m.includes('png')) return 'png'
	if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
	if (m.includes('webp')) return 'webp'
	if (m.includes('mp4')) return 'mp4'
	if (m.includes('webm')) return 'webm'
	if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
	if (m.includes('wav')) return 'wav'
	return fallback
}

const enc = new TextEncoder()
function multipartBody(boundary: string, filename: string, mime: string, bytes: Uint8Array): ArrayBuffer {
	const head = enc.encode(
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
		`Content-Type: ${mime}\r\n\r\n`,
	)
	const tail = enc.encode(`\r\n--${boundary}--\r\n`)
	const out = new Uint8Array(head.length + bytes.length + tail.length)
	out.set(head, 0)
	out.set(bytes, head.length)
	out.set(tail, head.length + bytes.length)
	return out.buffer
}

/** Shared HTTP + asset/poll/download plumbing for all four capability providers. */
class StoryverseClient {
	protected baseUrl: string
	protected token: string
	protected app: App
	protected outputDir: string

	constructor(baseUrl: string, token: string, app: App, outputDir: string) {
		this.baseUrl = (baseUrl || '').replace(/\/+$/, '')
		this.token = token
		this.app = app
		this.outputDir = outputDir
	}

	private headers(extra?: Record<string, string>): Record<string, string> {
		return { 'Authorization': `Bearer ${this.token}`, ...(extra || {}) }
	}

	/**
	 * Turn a `{status:'failed', error:{code,message}}` body (or any 4xx/5xx) into a thrown Error.
	 * Sanitizes the message: caps length to 200 chars, scrubs URLs and file paths so
	 * upstream internal endpoints / debug info never leak to the user-facing Notice.
	 */
	private fail(resp: RequestUrlResponse): never {
		let body: unknown = resp.json
		if (typeof body === 'undefined') { try { body = JSON.parse(resp.text || '') } catch { body = null } }
		const err = (body as { error?: { code?: string; message?: string } })?.error
		const code = err?.code ? `${err.code} — ` : ''
		const rawMsg = err?.message || resp.text || `HTTP ${resp.status}`
		throw new Error(`Storyverse: ${code}${sanitizeRouterMessage(rawMsg)}`)
	}

	protected async postJson(path: string, body: unknown): Promise<RequestUrlResponse> {
		const resp = await requestUrl({
			url: `${this.baseUrl}${path}`,
			method: 'POST',
			headers: this.headers({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(body),
			throw: false,
		})
		if (resp.status >= 400) this.fail(resp)
		return resp
	}

	/** Upload a reference (data: URI or http(s) URL) to /v1/uploads, return the router asset_id. */
	protected async uploadAsset(ref: string): Promise<string> {
		let bytes: Uint8Array
		let mime: string
		if (/^data:/.test(ref)) {
			const match = ref.match(/^data:([^;]+);base64,(.+)$/)
			if (!match) throw new Error('Storyverse: unsupported reference data URI')
			mime = match[1]
			bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))
		} else if (/^https?:/.test(ref)) {
			const got = await requestUrl({ url: ref })
			bytes = new Uint8Array(got.arrayBuffer)
			mime = got.headers?.['content-type'] || got.headers?.['Content-Type'] || 'application/octet-stream'
		} else {
			throw new Error('Storyverse: unsupported reference format')
		}
		const boundary = '----BragiStoryverseBoundary' + Math.random().toString(36).slice(2)
		const resp = await requestUrl({
			url: `${this.baseUrl}/v1/uploads`,
			method: 'POST',
			headers: this.headers({ 'Content-Type': `multipart/form-data; boundary=${boundary}` }),
			body: multipartBody(boundary, `ref.${extFromMime(mime, 'png')}`, mime, bytes),
			throw: false,
		})
		if (resp.status >= 400) this.fail(resp)
		const assetId = (resp.json as { asset_id?: string })?.asset_id
		if (!assetId) throw new Error('Storyverse: upload returned no asset_id')
		return assetId
	}

	protected async uploadAssets(refs: string[] | undefined): Promise<string[]> {
		if (!refs || refs.length === 0) return []
		const ids: string[] = []
		for (const ref of refs) ids.push(await this.uploadAsset(ref))
		return ids
	}

	/** One poll of GET /v1/tasks/{provider}/{task_id}. */
	protected async pollOnce(provider: string, taskId: string): Promise<RequestUrlResponse> {
		const resp = await requestUrl({
			url: `${this.baseUrl}/v1/tasks/${encodeURIComponent(provider)}/${encodeURIComponent(taskId)}`,
			method: 'GET',
			headers: this.headers(),
			throw: false,
		})
		if (resp.status >= 400) this.fail(resp)
		return resp
	}

	/** Block until an async task finishes (for the sync-only image/audio interfaces). */
	protected async pollUntilDone(provider: string, taskId: string): Promise<RouterOutput[]> {
		const deadline = Date.now() + POLL_TIMEOUT_MS
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const resp = await this.pollOnce(provider, taskId)
			const data = resp.json as { status?: string; outputs?: RouterOutput[]; error?: { code?: string; message?: string }; poll_after_ms?: number }
			if (data?.status === 'succeeded') return data.outputs || []
			if (data?.status === 'failed') {
				const e = data.error
				throw new Error(`Storyverse: ${e?.code ? e.code + ' — ' : ''}${sanitizeRouterMessage(e?.message || 'task failed')}`)
			}
			if (Date.now() > deadline) throw new Error('Storyverse: timed out waiting for task')
			await sleep(Math.max(1000, num(data?.poll_after_ms, DEFAULT_POLL_MS)))
		}
	}

	/** Download a URL into the vault output dir, return the vault-relative path. */
	protected async downloadToVault(url: string, prefix: string, ext: string): Promise<string> {
		const got = await requestUrl({ url })
		const filePath = `${this.outputDir}/${prefix}_${Date.now()}.${ext}`
		const adapter = this.app.vault.adapter
		if (!await adapter.exists(this.outputDir)) await adapter.mkdir(this.outputDir)
		await adapter.writeBinary(filePath, got.arrayBuffer)
		return filePath
	}

	protected async writeBytesToVault(bytes: ArrayBuffer, prefix: string, ext: string): Promise<string> {
		const filePath = `${this.outputDir}/${prefix}_${Date.now()}.${ext}`
		const adapter = this.app.vault.adapter
		if (!await adapter.exists(this.outputDir)) await adapter.mkdir(this.outputDir)
		await adapter.writeBinary(filePath, bytes)
		return filePath
	}
}

// ── Image ──
export class StoryverseImageProvider extends StoryverseClient implements ImageProvider {
	name = 'Storyverse Cloud'

	async generateImage(prompt: string, params: Record<string, unknown> = {}): Promise<GenerateImageResult> {
		const model = str(params.modelId)
		const refs = IMAGE_MODELS_ACCEPTING_REFS.has(model) ? (params.refImages as string[] | undefined) : undefined
		refuseTooManyRefs(model, refs)
		const inputAssets = await this.uploadAssets(refs)
		const body = this.buildBody(model, prompt, params, inputAssets)
		const resp = await this.postJson('/v1/images/generations', body)

		if (resp.status === 202) {
			const { provider, task_id } = resp.json as { provider: string; task_id: string }
			const outputs = await this.pollUntilDone(provider, task_id)
			const url = outputs.find(o => o.url)?.url
			if (!url) throw new Error('Storyverse: task succeeded but returned no image')
			return { filePath: await this.downloadToVault(url, 'storyverse', extFromMime(outputs[0]?.mime_type || '', 'png')) }
		}
		const url = (resp.json as { data?: Array<{ url?: string }> })?.data?.[0]?.url
		if (!url) throw new Error('Storyverse: no image url in response')
		return { filePath: await this.downloadToVault(url, 'storyverse', 'png') }
	}

	private buildBody(model: string, prompt: string, p: Record<string, unknown>, inputAssets: string[]): Record<string, unknown> {
		const assets = inputAssets.length ? { input_assets: inputAssets } : {}
		switch (model) {
			case 'gpt-image-2':
				// Router gpt-image-2 schema accepts size ∈ {1024x1024, 1792x1024, 1024x1792} (no imageSize/quality
				// fields). aspectToSize throws on ratios outside the supported three.
				return { model, prompt, n: 1, size: aspectToSize(p.aspectRatio), ...assets }
			case 'nano-banana-pro':
			case 'nano-banana-2':
				return { model, prompt, aspectRatio: str(p.aspectRatio, '1:1'), ...assets }
			case 'seedream-4.5':
			case 'seedream-5.0':
				return { model, prompt, aspectRatio: str(p.aspectRatio, '1:1'), n: 1, ...assets }
			case 'grok-imagine': {
				// Plugin model declares image-ref-to-image mode (XAI direct supports it via
				// quality-priority swap), but the V1 router schema for grok-imagine accepts only
				// { prompt, aspectRatio } — no input_assets. Refuse explicitly rather than
				// silently dropping the user's ref image, which would render unrelated content.
				const userRefs = (p.refImages as string[] | undefined) || []
				if (userRefs.length > 0) {
					throw new Error('Storyverse: grok-imagine does not support reference images in the V1 router schema (text-to-image only). Pick a different provider for this model or use text-to-image mode.')
				}
				return { model, prompt, aspectRatio: str(p.aspectRatio, '1:1') }
			}
			case 'midjourney-v8':
			case 'midjourney-niji-7':
				// Plugin quality is '1'/'4' (cost tier); router enum is low/medium/high. Map at the boundary.
				return { model, prompt, quality: remapMidjourneyQuality(str(p.quality, '1')), ...(model === 'midjourney-niji-7' ? { niji: true } : {}) }
			default:
				return { model, prompt, ...assets }
		}
	}
}

// ── Video (always async; polled by the plugin task queue via checkStatus) ──
export class StoryverseVideoProvider extends StoryverseClient implements VideoProvider {
	name = 'Storyverse Cloud'

	async generateVideo(prompt: string, params: Record<string, unknown> = {}): Promise<GenerateVideoResult> {
		const model = str(params.modelId)
		const refs = VIDEO_MODELS_ACCEPTING_REFS.has(model) ? (params.refImages as string[] | undefined) : undefined
		refuseTooManyRefs(model, refs)
		const inputAssets = await this.uploadAssets(refs)
		const body = this.buildBody(model, prompt, params, inputAssets)
		const resp = await this.postJson('/v1/videos/generations', body)
		const { provider, task_id } = resp.json as { provider: string; task_id: string }
		if (!provider || !task_id) throw new Error('Storyverse: video request returned no task id')
		// The task queue hands back a single string; encode the router provider with it.
		return { done: false, taskId: `${provider}::${task_id}` }
	}

	async checkStatus(encoded: string): Promise<GenerateVideoResult> {
		const sep = encoded.indexOf('::')
		const provider = sep >= 0 ? encoded.slice(0, sep) : ''
		const taskId = sep >= 0 ? encoded.slice(sep + 2) : encoded
		const resp = await this.pollOnce(provider, taskId)
		const data = resp.json as { status?: string; outputs?: RouterOutput[]; error?: { code?: string; message?: string } }
		if (data?.status === 'succeeded') {
			const out = (data.outputs || []).find(o => o.url)
			if (!out?.url) throw new Error('Storyverse: video task succeeded but returned no url')
			const filePath = await this.downloadToVault(out.url, 'storyverse', extFromMime(out.mime_type || '', 'mp4'))
			return { done: true, filePath }
		}
		if (data?.status === 'failed') {
			const e = data.error
			throw new Error(`Storyverse: ${e?.code ? e.code + ' — ' : ''}${sanitizeRouterMessage(e?.message || 'video task failed')}`)
		}
		return { done: false, taskId: encoded }
	}

	private buildBody(model: string, prompt: string, p: Record<string, unknown>, inputAssets: string[]): Record<string, unknown> {
		const assets = inputAssets.length ? { input_assets: inputAssets } : {}
		switch (model) {
			case 'kling-2.6':
			case 'kling-3.0':
				return { model, prompt, duration: str(p.duration, '5'), aspectRatio: str(p.aspect_ratio, '16:9'), ...assets }
			case 'seedance-2.0':
			case 'seedance-2.0-fast':
				return { model, prompt, duration: str(p.duration, '-1'), ratio: str(p.ratio, '16:9'), generate_audio: bool(p.generate_audio, true), ...assets }
			case 'grok-video':
				// Router schema requires `input_assets.min(1)`; non-panel callers (MCP, scripted)
				// might hit text-to-video / video-extend without a ref — pre-empt with a clear error
				// rather than letting it 400 at the router.
				if (inputAssets.length === 0) {
					throw new Error('Storyverse: grok-video requires a reference image (V1 router schema does not support text-to-video / video-extend). Attach an image upstream or pick a different provider for this model.')
				}
				return { model, prompt, duration: '6', input_assets: inputAssets }
			case 'veo-3.1':
			case 'veo-3.1-lite': {
				// V1 router /v1/videos/generations Veo schema accepts only { prompt, aspectRatio }
				// — no input_assets, no duration, no resolution. Detect ref usage by inspecting the
				// user's `refImages` directly (inputAssets is already empty here because veo isn't
				// in VIDEO_MODELS_ACCEPTING_REFS — we drop refs before reaching this branch).
				const userRefs = (p.refImages as string[] | undefined) || []
				if (userRefs.length > 0) {
					throw new Error('Storyverse: Veo does not support reference frames in the V1 router schema. Pick a different provider or wait for the V2 router upgrade.')
				}
				return { model, prompt, aspectRatio: str(p.aspectRatio, '16:9') }
			}
			case 'luma-uni-1':
				return { model, prompt, aspectRatio: str(p.aspectRatio, '16:9'), ...assets }
			default:
				return { model, prompt, ...assets }
		}
	}
}

// ── Text ──
export class StoryverseTextProvider extends StoryverseClient implements TextGenProvider {
	name = 'Storyverse Cloud'

	async generateText(prompt: string, params: Record<string, unknown> = {}): Promise<TextGenResult> {
		const model = str(params.modelId)
		// Inject the shared SYSTEM_PROMPT so cloud-mode text honors the same ---SPLIT--- convention
		// as every Local-mode text provider (text-gen.ts). Without this, multi-segment splitting silently breaks.
		const resp = await this.postJson('/v1/chat/completions', {
			model,
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: prompt },
			],
			stream: false,
		})
		const content = (resp.json as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content
		if (typeof content !== 'string') throw new Error('Storyverse: no text in chat completion')
		return { text: content }
	}
}

// ── Audio (speech sync bytes; music/sfx may be 200 bytes or 202 async) ──
export class StoryverseAudioProvider extends StoryverseClient implements AudioProvider {
	name = 'Storyverse Cloud'

	async generateAudio(prompt: string, options: { mode: 'tts' | 'music' | 'sound-effect'; modelId?: string; [k: string]: unknown }): Promise<GenerateAudioResult> {
		const model = str(options.modelId)
		const { path, body } = this.buildRequest(model, prompt, options)
		const resp = await requestUrl({
			url: `${this.baseUrl}${path}`,
			method: 'POST',
			headers: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			throw: false,
		})
		if (resp.status >= 400) {
			let err: unknown = resp.json
			if (typeof err === 'undefined') { try { err = JSON.parse(resp.text || '') } catch { err = null } }
			const e = (err as { error?: { code?: string; message?: string } })?.error
			throw new Error(`Storyverse: ${e?.code ? e.code + ' — ' : ''}${sanitizeRouterMessage(e?.message || `HTTP ${resp.status}`)}`)
		}

		const ext = body.response_format ? str(body.response_format, 'mp3') : 'mp3'
		// Async (202 JSON) → poll then download; sync (200 bytes) → write directly.
		const contentType = resp.headers?.['content-type'] || resp.headers?.['Content-Type'] || ''
		if (resp.status === 202 || contentType.includes('application/json')) {
			const { provider, task_id } = resp.json as { provider: string; task_id: string }
			const outputs = await this.pollUntilDone(provider, task_id)
			const url = outputs.find(o => o.url)?.url
			if (!url) throw new Error('Storyverse: audio task succeeded but returned no url')
			return { filePath: await this.downloadToVault(url, 'storyverse', extFromMime(outputs[0]?.mime_type || '', ext)) }
		}
		return { filePath: await this.writeBytesToVault(resp.arrayBuffer, 'storyverse', ext) }
	}

	private buildRequest(model: string, prompt: string, p: Record<string, unknown>): { path: string; body: Record<string, unknown> } {
		switch (model) {
			case 'grok-tts':
				// Plugin voice options are xAI-style names; router enum is OpenAI-style. Remap at the boundary.
				return { path: '/v1/audio/speech', body: { model, input: prompt, voice: remapGrokTtsVoice(str(p.voice, 'eve')), response_format: str(p.response_format, 'mp3'), speed: num(p.speed, 1) } }
			case 'elevenlabs-tts-v3':
				return { path: '/v1/audio/speech', body: { model, input: prompt, voice: str(p.voice), response_format: str(p.response_format, 'mp3') } }
			case 'elevenlabs-music':
				// `music_length_ms` is a misnomer on the plugin side — the slider value is in SECONDS
				// (audio.ts: min 3, max 300, unit 's'). Local ElevenLabs (elevenlabs.ts) multiplies by 1000
				// before sending. Keep cloud parity: multiply here too.
				return { path: '/v1/audio/music', body: { model, prompt, duration_ms: Math.round(num(p.music_length_ms, 30) * 1000), instrumental: bool(p.instrumental) } }
			case 'elevenlabs-sfx':
				return { path: '/v1/audio/sfx', body: { model, prompt, duration_seconds: num(p.duration, 5) } }
			default:
				return { path: '/v1/audio/speech', body: { model, input: prompt, voice: str(p.voice), response_format: 'mp3' } }
		}
	}
}

/** Standalone auth check for the settings "Test Token" button. */
export async function testStoryverseAuth(baseUrl: string, token: string): Promise<{ ok: boolean; message: string }> {
	try {
		const resp = await requestUrl({
			url: `${(baseUrl || '').replace(/\/+$/, '')}/v1/auth/check`,
			method: 'POST',
			headers: { 'Authorization': `Bearer ${token}` },
			throw: false,
		})
		if (resp.status === 200 && (resp.json as { ok?: boolean })?.ok) {
			// Intentionally NOT echoing the router's `label` field — it may carry the
			// raw svsk- token (current router does), a tenant / env name, or other
			// internal identifier. Generic success keeps the UI Notice safe to screenshot.
			return { ok: true, message: 'Token OK' }
		}
		if (resp.status === 401) return { ok: false, message: 'Token not recognized' }
		return { ok: false, message: `Unexpected status ${resp.status}` }
	} catch (err: unknown) {
		const raw = (err as { message?: string })?.message || String(err)
		return { ok: false, message: `Network error: ${sanitizeRouterMessage(raw)}` }
	}
}

/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Resume strict linting after the runtime-shaped data boundary. */
