/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Router payloads are runtime-shaped data narrowed at use sites. */
import type { App, RequestUrlResponse } from 'obsidian'
import { requestUrl } from 'obsidian'
import type {
	ImageProvider, VideoProvider, AudioProvider,
	GenerateImageResult, GenerateVideoResult, GenerateAudioResult,
} from './types'
import type { TextGenProvider, TextGenResult } from './text-gen'

/**
 * Storyverse Cloud provider — plugin client for the Bragi V1 router.
 *
 * In Cloud Mode every model routes through one router with a single `svsk-` token.
 * The router (its `registry.ts`) is the source of truth for which real provider
 * serves each model, so the plugin sends ONLY `model` (+ params), never a provider.
 *
 * Contract (frozen, see server/src + https://35.168.148.47.nip.io/docs):
 *   - sync image/text  → 200 JSON
 *   - async image/video → 202 { task_id, provider, poll_after_ms, poll_url }, poll GET /v1/tasks/{provider}/{task_id}
 *   - audio speech → 200 raw bytes; music/sfx may be 200 bytes or 202 async
 *   - reference assets → POST /v1/uploads (field `file`) → asset_id, passed back as input_assets
 *   - errors → { status:'failed', error:{ code, message } }
 */

const POLL_TIMEOUT_MS = 5 * 60 * 1000   // give async image/audio up to 5 min inline
const DEFAULT_POLL_MS = 4000

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

/** OpenAI gpt-image-2 takes a pixel `size`, not an aspect ratio. */
function aspectToSize(aspectRatio: unknown): string {
	switch (str(aspectRatio)) {
		case '16:9': return '1792x1024'
		case '9:16': return '1024x1792'
		default: return '1024x1024'
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

	/** Turn a `{status:'failed', error:{code,message}}` body (or any 4xx/5xx) into a thrown Error. */
	private fail(resp: RequestUrlResponse): never {
		let body: unknown = resp.json
		if (typeof body === 'undefined') { try { body = JSON.parse(resp.text || '') } catch { body = null } }
		const err = (body as { error?: { code?: string; message?: string } })?.error
		const code = err?.code ? `${err.code} — ` : ''
		const msg = err?.message || resp.text?.substring(0, 200) || `HTTP ${resp.status}`
		throw new Error(`Storyverse: ${code}${msg}`)
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
				throw new Error(`Storyverse: ${e?.code ? e.code + ' — ' : ''}${e?.message || 'task failed'}`)
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
		const inputAssets = await this.uploadAssets(params.refImages as string[] | undefined)
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
				return { model, prompt, n: 1, size: aspectToSize(p.aspectRatio), ...assets }
			case 'nano-banana-pro':
			case 'nano-banana-2':
				return { model, prompt, aspectRatio: str(p.aspectRatio, '1:1'), ...assets }
			case 'seedream-4.5':
			case 'seedream-5.0':
				return { model, prompt, aspectRatio: str(p.aspectRatio, '1:1'), n: 1, ...assets }
			case 'grok-imagine':
				return { model, prompt, aspectRatio: str(p.aspectRatio, '1:1') }
			case 'midjourney-v8':
			case 'midjourney-niji-7': {
				// Plugin quality is '1'/'4'; router enum is low|medium|high.
				const quality = str(p.quality) === '4' ? 'high' : 'medium'
				return { model, prompt, quality, ...(model === 'midjourney-niji-7' ? { niji: true } : {}) }
			}
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
		const inputAssets = await this.uploadAssets(params.refImages as string[] | undefined)
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
			throw new Error(`Storyverse: ${e?.code ? e.code + ' — ' : ''}${e?.message || 'video task failed'}`)
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
				return { model, prompt, duration: '6', input_assets: inputAssets }
			case 'veo-3.1':
			case 'veo-3.1-lite':
				return { model, prompt, aspectRatio: str(p.aspectRatio, '16:9') }
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
		const resp = await this.postJson('/v1/chat/completions', {
			model,
			messages: [{ role: 'user', content: prompt }],
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
			throw new Error(`Storyverse: ${e?.code ? e.code + ' — ' : ''}${e?.message || `HTTP ${resp.status}`}`)
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
				return { path: '/v1/audio/speech', body: { model, input: prompt, voice: str(p.voice, 'alloy'), response_format: str(p.response_format, 'mp3'), speed: num(p.speed, 1) } }
			case 'elevenlabs-tts-v3':
				return { path: '/v1/audio/speech', body: { model, input: prompt, voice: str(p.voice), response_format: str(p.response_format, 'mp3') } }
			case 'elevenlabs-music':
				return { path: '/v1/audio/music', body: { model, prompt, duration_ms: Math.round(num(p.music_length_ms, 30000)), instrumental: bool(p.instrumental) } }
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
			return { ok: true, message: `Token OK (${(resp.json as { label?: string }).label || 'authenticated'})` }
		}
		if (resp.status === 401) return { ok: false, message: 'Token not recognized' }
		return { ok: false, message: `Unexpected status ${resp.status}` }
	} catch (err: unknown) {
		return { ok: false, message: `Network error: ${(err as { message?: string })?.message || String(err)}` }
	}
}

/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Resume strict linting after the runtime-shaped data boundary. */
