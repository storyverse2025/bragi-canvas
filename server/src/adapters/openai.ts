import type { Adapter, SyncResult } from './types.js'
import { ApiError, toHttpStatus } from '../errors.js'
import type { ChatCompletionsRequest } from '../schemas/chat-completions.js'
import type { ImagesGenerationsRequest } from '../schemas/images-generations.js'

const BASE = 'https://api.openai.com/v1'

export class OpenAIAdapter implements Adapter {
  readonly name = 'openai'
  constructor(private apiKey: string) {}

  private async call(path: string, body: unknown): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (e: any) {
      throw new ApiError('provider_unavailable', `openai network error: ${e?.message ?? e}`, 503, { transport_error: String(e?.message ?? e) })
    }
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }
    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      throw new ApiError(code, parsed?.error?.message ?? `OpenAI ${res.status}`, toHttpStatus(res.status), parsed)
    }
    return parsed
  }

  async chatCompletion(req: ChatCompletionsRequest): Promise<SyncResult> {
    const t0 = Date.now()
    const r: any = await this.call('/chat/completions', {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature,
      max_tokens: (req as any).max_tokens,
    })
    return {
      status: 'succeeded',
      outputs: [{ kind: 'text', text: r.choices[0].message.content }],
      provider: 'openai',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }

  async imageGeneration(req: Extract<ImagesGenerationsRequest, { model: 'gpt-image-2' }>): Promise<SyncResult> {
    const t0 = Date.now()
    const r: any = await this.call('/images/generations', {
      model: 'gpt-image-1',
      prompt: req.prompt,
      n: req.n,
      size: req.size,
    })
    return {
      status: 'succeeded',
      outputs: (r.data as Array<{ url: string }>).map(d => ({ kind: 'image' as const, url: d.url, mime_type: 'image/png' })),
      provider: 'openai',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }
}
