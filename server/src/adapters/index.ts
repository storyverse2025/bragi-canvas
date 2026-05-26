import type { Adapter } from './types.js'
import { OpenAIAdapter } from './openai.js'
import { GeminiAdapter } from './gemini.js'
import { ByteplusAdapter } from './byteplus.js'
import { FalAdapter } from './fal.js'
import { LumaAdapter } from './luma.js'
import { XAIAdapter } from './xai.js'
import { LegnextAdapter } from './legnext.js'
import { TokenrouterAdapter } from './tokenrouter.js'
import type { Provider } from '../registry.js'
import { ApiError } from '../errors.js'

const adapters: Partial<Record<Provider, Adapter>> = {}

function get(p: Provider): Adapter {
  if (adapters[p]) return adapters[p]!
  let a: Adapter | undefined
  const E = process.env  // read env at request time for testability
  switch (p) {
    case 'openai':
      if (E.OPENAI_API_KEY) a = new OpenAIAdapter(E.OPENAI_API_KEY)
      break
    case 'gemini':
      if (E.GEMINI_API_KEY) a = new GeminiAdapter(E.GEMINI_API_KEY)
      break
    case 'byteplus': {
      const k = E.BYTEPLUS_API_KEY
      const ak = E.BYTEPLUS_ACCESS_KEY
      const sk = E.BYTEPLUS_SECRET_KEY
      const project = E.BYTEPLUS_PROJECT
      if (k && ak && sk && project) a = new ByteplusAdapter({ apiKey: k, accessKey: ak, secretKey: sk, project })
      break
    }
    case 'fal':
      if (E.FAL_API_KEY) a = new FalAdapter(E.FAL_API_KEY)
      break
    case 'luma': {
      const bt = E.LUMA_PROXY_BEARER_TOKEN ?? E.LUMA_TOKEN
      const bu = E.LUMA_PROXY_BASE_URL ?? 'https://luma.bragi.now'
      if (bt) a = new LumaAdapter({ bearerToken: bt, baseUrl: bu })
      break
    }
    case 'xai':
      if (E.XAI_API_KEY) a = new XAIAdapter(E.XAI_API_KEY)
      break
    case 'legnext':
      if (E.LEGNEXT_API_KEY) a = new LegnextAdapter(E.LEGNEXT_API_KEY)
      break
    case 'tokenrouter':
      if (E.TOKENROUTER_API_KEY) a = new TokenrouterAdapter(E.TOKENROUTER_API_KEY)
      break
  }
  if (!a) throw new ApiError('provider_unavailable', `provider ${p} not configured (missing key)`, 503)
  adapters[p] = a
  return a
}

export function adapterFor(provider: Provider): Adapter {
  return get(provider)
}

// for testing only
export function resetAdapterCache(): void {
  for (const k of Object.keys(adapters)) delete adapters[k as Provider]
}
