export type Provider = 'openai' | 'gemini' | 'byteplus' | 'fal' | 'luma' | 'xai' | 'legnext' | 'tokenrouter' | 'apimart'
export type Capability = 'image' | 'video' | 'text' | 'audio'

export interface RegistryEntry {
  provider: Provider
  capability: Capability
  async: boolean
}

const REGISTRY: Record<string, RegistryEntry> = {
  // image
  'gpt-image-2':        { provider: 'apimart',     capability: 'image', async: true  },  // was openai/sync
  'nano-banana-pro':    { provider: 'fal',         capability: 'image', async: true  },  // was gemini/sync
  'nano-banana-2':      { provider: 'fal',         capability: 'image', async: true  },  // was gemini/sync
  'seedream-4.5':       { provider: 'byteplus',    capability: 'image', async: false },
  'seedream-5.0':       { provider: 'byteplus',    capability: 'image', async: false },
  'grok-imagine':       { provider: 'xai',         capability: 'image', async: false },
  'midjourney-v8':      { provider: 'legnext',     capability: 'image', async: true  },
  'midjourney-niji-7':  { provider: 'legnext',     capability: 'image', async: true  },

  // video
  'kling-2.6':          { provider: 'fal',         capability: 'video', async: true },
  'kling-3.0':          { provider: 'fal',         capability: 'video', async: true },
  'grok-video':         { provider: 'fal',         capability: 'video', async: true },
  'seedance-2.0':       { provider: 'byteplus',    capability: 'video', async: true },
  'seedance-2.0-fast':  { provider: 'byteplus',    capability: 'video', async: true },
  'veo-3.1':            { provider: 'gemini',      capability: 'video', async: true },
  'veo-3.1-lite':       { provider: 'gemini',      capability: 'video', async: true },
  'luma-uni-1':         { provider: 'luma',        capability: 'video', async: true },

  // text — gpt-5.4-pro, gemini-3-flash, gemini-3.1-pro now via tokenrouter
  'gemini-3-flash':     { provider: 'tokenrouter', capability: 'text', async: false },
  'gemini-3.1-pro':     { provider: 'tokenrouter', capability: 'text', async: false },
  'gpt-5.4-pro':        { provider: 'tokenrouter', capability: 'text', async: false },
  'qwen-3-6-plus':      { provider: 'tokenrouter', capability: 'text', async: false },

  // audio
  'grok-tts':           { provider: 'xai',  capability: 'audio', async: false },
  'elevenlabs-tts-v3':  { provider: 'fal',  capability: 'audio', async: true  },
  'elevenlabs-music':   { provider: 'fal',  capability: 'audio', async: true  },
  'elevenlabs-sfx':     { provider: 'fal',  capability: 'audio', async: true  },
}

export function lookupModel(modelId: string): RegistryEntry | undefined {
  return REGISTRY[modelId]
}

export const ALL_MODEL_IDS = Object.keys(REGISTRY)
