import { ApiError } from './errors.js'

export type Provider = 'openai' | 'gemini' | 'byteplus' | 'fal' | 'luma' | 'xai' | 'legnext' | 'tokenrouter' | 'apimart' | 'elevenlabs'
export type Capability = 'image' | 'video' | 'text' | 'audio'

export interface RegistryEntry {
  provider: Provider
  capability: Capability
  async: boolean
}

const REGISTRY: Record<string, RegistryEntry> = {
  // image
  'gpt-image-2':        { provider: 'apimart',     capability: 'image', async: true  },  // confirmed apimart ✓
  'nano-banana-pro':    { provider: 'apimart',     capability: 'image', async: true  },  // apimart: gemini-3-pro-image-preview ✓ (fal balance exhausted)
  'nano-banana-2':      { provider: 'apimart',     capability: 'image', async: true  },  // apimart: gemini-3.1-flash-image-preview ✓ (fal balance exhausted)
  'seedream-4.5':       { provider: 'byteplus',    capability: 'image', async: false },
  'seedream-5.0':       { provider: 'byteplus',    capability: 'image', async: false },
  'grok-imagine':       { provider: 'xai',         capability: 'image', async: false },
  'midjourney-v8':      { provider: 'legnext',     capability: 'image', async: true  },
  'midjourney-niji-7':  { provider: 'legnext',     capability: 'image', async: true  },

  // video
  'kling-2.6':          { provider: 'fal',         capability: 'video', async: true },
  'kling-3.0':          { provider: 'fal',         capability: 'video', async: true },
  'grok-video':         { provider: 'xai',         capability: 'video', async: true },  // xai native (POST /v1/videos/generations) ✓ was fal
  'seedance-2.0':       { provider: 'tokenrouter', capability: 'video', async: true },  // tokenrouter (OpenAI Videos API); byteplus available as fallback
  'seedance-2.0-fast':  { provider: 'tokenrouter', capability: 'video', async: true },  // tokenrouter; byteplus available as fallback
  'veo-3.1':            { provider: 'gemini',      capability: 'video', async: true },
  'veo-3.1-lite':       { provider: 'gemini',      capability: 'video', async: true },
  'luma-uni-1':         { provider: 'luma',        capability: 'image', async: false },

  // text — gpt-5.5-pro, gemini-3-flash, gemini-3.1-pro now via tokenrouter
  'gemini-3-flash':     { provider: 'tokenrouter', capability: 'text', async: false },
  'gemini-3.1-pro':     { provider: 'tokenrouter', capability: 'text', async: false },
  'gpt-5.5-pro':        { provider: 'tokenrouter', capability: 'text', async: false },
  'qwen-3-6-plus':      { provider: 'tokenrouter', capability: 'text', async: false },
  'gpt-5.5':            { provider: 'tokenrouter', capability: 'text', async: false },
  'gemini-3.5-flash':   { provider: 'tokenrouter', capability: 'text', async: false },
  'claude-opus-4-7':    { provider: 'tokenrouter', capability: 'text', async: false },
  'claude-sonnet-4-6':  { provider: 'tokenrouter', capability: 'text', async: false },
  'grok-4-3':           { provider: 'tokenrouter', capability: 'text', async: false },
  'grok-4-fast':        { provider: 'tokenrouter', capability: 'text', async: false },

  // audio — all elevenlabs models → direct ElevenLabs native (paid key confirmed 2026-05-27)
  //         elevenlabs-music: paid plan required (200 bytes confirmed with new key)
  'grok-tts':           { provider: 'xai',         capability: 'audio', async: false },
  'elevenlabs-tts-v3':  { provider: 'elevenlabs',  capability: 'audio', async: false },
  'elevenlabs-music':   { provider: 'elevenlabs',  capability: 'audio', async: false },
  'elevenlabs-sfx':     { provider: 'elevenlabs',  capability: 'audio', async: false },
}

/**
 * Which providers have been verified as working for each model.
 * Used by the provider override feature to validate caller-supplied provider values.
 * Only lists providers that have a working implementation in this server.
 */
export const MODEL_PROVIDER_OPTIONS: Record<string, Set<Provider>> = {
  'gpt-image-2':        new Set(['apimart']),
  'nano-banana-pro':    new Set(['apimart', 'fal']),
  'nano-banana-2':      new Set(['apimart', 'fal']),
  'seedream-4.5':       new Set(['byteplus']),
  'seedream-5.0':       new Set(['byteplus']),
  'grok-imagine':       new Set(['xai']),
  'midjourney-v8':      new Set(['legnext']),
  'midjourney-niji-7':  new Set(['legnext']),
  'kling-2.6':          new Set(['fal']),
  'kling-3.0':          new Set(['fal']),
  'grok-video':         new Set(['xai']),
  'seedance-2.0':       new Set(['tokenrouter', 'byteplus']),
  'seedance-2.0-fast':  new Set(['tokenrouter', 'byteplus']),
  'veo-3.1':            new Set(['gemini']),
  'veo-3.1-lite':       new Set(['gemini']),
  'luma-uni-1':         new Set(['luma']),
  'gemini-3-flash':     new Set(['tokenrouter']),
  'gemini-3.1-pro':     new Set(['tokenrouter']),
  'gpt-5.5-pro':        new Set(['tokenrouter']),
  'qwen-3-6-plus':      new Set(['tokenrouter']),
  'gpt-5.5':            new Set(['tokenrouter', 'openai']),
  'gemini-3.5-flash':   new Set(['tokenrouter', 'gemini']),
  'claude-opus-4-7':    new Set(['tokenrouter']),
  'claude-sonnet-4-6':  new Set(['tokenrouter']),
  'grok-4-3':           new Set(['tokenrouter']),
  'grok-4-fast':        new Set(['tokenrouter']),
  'grok-tts':           new Set(['xai']),
  'elevenlabs-tts-v3':  new Set(['elevenlabs', 'fal']),
  'elevenlabs-music':   new Set(['elevenlabs', 'fal']),
  'elevenlabs-sfx':     new Set(['elevenlabs', 'fal']),
}

export function lookupModel(modelId: string): RegistryEntry | undefined {
  return REGISTRY[modelId]
}

/**
 * Resolve the provider to use for a given model, honoring an optional override.
 * Returns { entry, provider } where provider may differ from entry.provider if overridden.
 * Throws ApiError(400) if the requested provider is not in MODEL_PROVIDER_OPTIONS[model].
 */
export function resolveProvider(
  modelId: string,
  requestedProvider?: string,
): { entry: RegistryEntry; provider: Provider } {
  const entry = REGISTRY[modelId]
  if (!entry) {
    throw new ApiError('unknown_model', `model ${modelId} not found in registry`, 400)
  }
  if (!requestedProvider) {
    return { entry, provider: entry.provider }
  }
  const options = MODEL_PROVIDER_OPTIONS[modelId]
  if (!options || !options.has(requestedProvider as Provider)) {
    const optList = options ? [...options].join(', ') : entry.provider
    throw new ApiError(
      'invalid_request',
      `provider '${requestedProvider}' not available for model '${modelId}' (options: ${optList})`,
      400,
    )
  }
  return { entry, provider: requestedProvider as Provider }
}

export const ALL_MODEL_IDS = Object.keys(REGISTRY)
