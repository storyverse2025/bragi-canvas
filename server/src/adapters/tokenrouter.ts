/**
 * Tokenrouter Adapter (OpenAI-compatible router for Qwen models)
 *
 * Tokenrouter is an OpenAI-compatible API router that provides access to various
 * LLM models including Qwen.
 *
 * Supported models:
 *   Chat (sync): qwen-3-6-plus → upstream "qwen/qwen3.6-plus"
 *
 * Auth: Authorization: Bearer ${TOKENROUTER_API_KEY}
 * Base: https://api.tokenrouter.com/v1
 *
 * CONCERNS / ASSUMPTIONS (verify during live smoke Task 31):
 *   1. BASE URL: "https://api.tokenrouter.ai/v1" — best guess. Confirm from vendor portal.
 *      Alternative: "https://api.tokenrouter.com/v1"
 *   2. Upstream model name for qwen-3-6-plus: "qwen3-72b" — best guess based on Qwen
 *      naming patterns. Alternative: "qwen-3-72b", "qwen-plus-latest", "qwen3-6b-plus".
 *      Live smoke will reveal the exact model ID accepted by Tokenrouter.
 *   3. OpenAI-compatible response shape: { choices: [{ message: { content } }] }
 *      This is assumed standard; confirm via live smoke.
 *   4. API key format starts with "sk-..." per data.json — consistent with OpenAI pattern.
 *   5. stream: false is forced; streaming not implemented in V1.
 */

import type { Adapter, SyncResult } from './types.js'
import { ApiError } from '../errors.js'
import type { ChatCompletionsRequest } from '../schemas/chat-completions.js'

const BASE = 'https://api.tokenrouter.com/v1'

/**
 * Map our model IDs to Tokenrouter upstream model names.
 * ASSUMPTION: Verify exact upstream model names via vendor portal or API docs.
 */
const MODEL_MAP: Record<string, string> = {
  'qwen-3-6-plus': 'qwen/qwen3.6-plus',
}

export class TokenrouterAdapter implements Adapter {
  readonly name = 'tokenrouter'

  constructor(private apiKey: string) {}

  /**
   * Map our model ID to the upstream model name for Tokenrouter.
   * Falls back to the raw model ID if no mapping found.
   */
  private upstreamModel(model: string): string {
    return MODEL_MAP[model] ?? model
  }

  async chatCompletion(
    req: Extract<ChatCompletionsRequest, { model: 'qwen-3-6-plus' }>,
  ): Promise<SyncResult> {
    const t0 = Date.now()

    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.upstreamModel(req.model),
        messages: req.messages,
        temperature: req.temperature,
        stream: false,
      }),
    })

    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      throw new ApiError(
        code,
        parsed?.error?.message ?? `Tokenrouter ${res.status}`,
        res.status === 429 ? 503 : res.status,
        parsed,
      )
    }

    return {
      status: 'succeeded',
      outputs: [{ kind: 'text', text: parsed.choices[0].message.content }],
      provider: 'tokenrouter',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }
}
