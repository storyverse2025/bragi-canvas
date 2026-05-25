#!/usr/bin/env tsx
import 'dotenv/config'
import { ALL_MODEL_IDS, lookupModel } from '../src/registry.js'
import { adapterFor } from '../src/adapters/index.js'

interface Result {
  model: string
  provider: string
  status: 'ok' | 'fail' | 'skip'
  ms: number
  err?: string
}

async function smokeOne(model: string): Promise<Result> {
  const entry = lookupModel(model)
  if (!entry) return { model, provider: '?', status: 'fail', ms: 0, err: 'not in registry' }
  const t0 = Date.now()
  try {
    const a = adapterFor(entry.provider)
    if (entry.capability === 'text' && a.chatCompletion) {
      await a.chatCompletion({ model, messages: [{ role: 'user', content: 'hi' }] } as any)
    } else if (entry.capability === 'image' && a.imageGeneration) {
      const req: any = { model, prompt: 'a red apple' }
      if (model === 'gpt-image-2') { req.size = '1024x1024'; req.n = 1 }
      else if (model.startsWith('nano-banana')) req.aspectRatio = '1:1'
      else if (model.startsWith('seedream')) { req.aspectRatio = '1:1'; req.n = 1 }
      else if (model === 'grok-imagine') req.aspectRatio = '1:1'
      else if (model.startsWith('midjourney')) req.quality = 'medium'
      await a.imageGeneration(req)
    } else if (entry.capability === 'video' && a.videoGeneration) {
      const req: any = { model, prompt: 'cat walks' }
      if (model.startsWith('kling')) { req.duration = '5'; req.aspectRatio = '9:16' }
      else if (model.startsWith('seedance')) { req.duration = '5'; req.ratio = '9:16'; req.resolution = '480p'; req.generate_audio = false }
      else if (model === 'grok-video') req.duration = '6'
      else if (model.startsWith('veo')) req.aspectRatio = '9:16'
      else if (model === 'luma-uni-1') req.aspectRatio = '9:16'
      await a.videoGeneration(req)
    } else if (entry.capability === 'audio') {
      if (model === 'grok-tts' && a.audioSpeech) {
        await a.audioSpeech({ model, input: 'hi', voice: 'alloy', response_format: 'mp3', speed: 1 } as any)
      } else if (model === 'elevenlabs-tts-v3' && a.audioSpeech) {
        await a.audioSpeech({ model, input: 'hi', voice: 'rachel', response_format: 'mp3' } as any)
      } else if (model === 'elevenlabs-music' && a.audioMusic) {
        await a.audioMusic({ model, prompt: 'jazz', duration_ms: 3000, instrumental: true } as any)
      } else if (model === 'elevenlabs-sfx' && a.audioSfx) {
        await a.audioSfx({ model, prompt: 'thunder', duration_seconds: 2 } as any)
      } else {
        return { model, provider: entry.provider, status: 'skip', ms: 0, err: 'no matching method' }
      }
    } else {
      return { model, provider: entry.provider, status: 'skip', ms: 0, err: `no method for ${entry.capability}` }
    }
    return { model, provider: entry.provider, status: 'ok', ms: Date.now() - t0 }
  } catch (e: any) {
    const errMsg = e?.code ? `${e.code}: ${e.message}` : String(e?.message ?? e)
    return { model, provider: entry.provider, status: 'fail', ms: Date.now() - t0, err: errMsg }
  }
}

async function main() {
  const arg = process.argv[2]
  let models = ALL_MODEL_IDS
  if (arg && !arg.startsWith('--')) {
    models = [arg]
  } else if (arg?.startsWith('--capability=')) {
    const cap = arg.split('=')[1]
    models = ALL_MODEL_IDS.filter(m => lookupModel(m)?.capability === cap)
  }

  console.log(`Smoke testing ${models.length} model(s)...\n`)
  const results: Result[] = []
  for (const m of models) {
    process.stdout.write(`${m.padEnd(25)} ... `)
    const r = await smokeOne(m)
    results.push(r)
    const status = r.status === 'ok' ? '✓' : r.status === 'skip' ? '⊘' : '✗'
    console.log(`${status} ${String(r.ms).padStart(5)}ms ${r.err ?? ''}`)
  }

  console.log('\n--- Summary ---')
  const ok = results.filter(r => r.status === 'ok').length
  const failed = results.filter(r => r.status === 'fail').length
  const skipped = results.filter(r => r.status === 'skip').length
  console.log(`ok=${ok} fail=${failed} skip=${skipped} total=${results.length}`)

  if (failed > 0) {
    console.log('\nFailures:')
    for (const r of results.filter(rr => rr.status === 'fail')) {
      console.log(`  ${r.model} (${r.provider}): ${r.err}`)
    }
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('smoke script error:', e)
  process.exit(2)
})
