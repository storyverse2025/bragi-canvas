import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nock from 'nock'
import error401Fx from '../fixtures/elevenlabs/error-401.json' with { type: 'json' }
import error402Fx from '../fixtures/elevenlabs/error-402.json' with { type: 'json' }
import { ElevenLabsAdapter } from '../../src/adapters/elevenlabs.js'

const BASE = 'https://api.elevenlabs.io'
const FAKE_AUDIO = Buffer.from('ID3\x04\x00\x00\x00\x00\x00fake-mp3-audio-bytes', 'ascii')

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'router-elevenlabs-'))
  process.env.ASSET_TMP_DIR = dir
  process.env.ASSET_SIGNING_SECRET = '0123456789abcdef0123456789abcdef'
  process.env.ROUTER_PUBLIC_URL = 'https://router.test'
})

afterEach(() => {
  nock.cleanAll()
})

describe('ElevenLabsAdapter', () => {
  // ---------------------------------------------------------------------------
  // audioSfx
  // ---------------------------------------------------------------------------
  describe('audioSfx', () => {
    it('happy path returns sync bytes Buffer', async () => {
      nock(BASE)
        .post('/v1/sound-generation')
        .reply(200, FAKE_AUDIO, { 'Content-Type': 'audio/mpeg' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      const result = await adapter.audioSfx!({
        model: 'elevenlabs-sfx',
        prompt: 'thunder storm',
        duration_seconds: 3,
      })

      if (!('bytes' in result)) throw new Error('expected sync bytes result')
      expect(result.status).toBe('succeeded')
      expect(Buffer.isBuffer(result.bytes)).toBe(true)
      expect(result.bytes.length).toBeGreaterThan(0)
      expect(result.mimeType).toBe('audio/mpeg')
      expect(result.provider).toBe('elevenlabs')
      expect(result.model).toBe('elevenlabs-sfx')
      expect(result.latency_ms).toBeGreaterThanOrEqual(0)
    })

    it('sends correct request body', async () => {
      let capturedBody: any
      nock(BASE)
        .post('/v1/sound-generation', body => {
          capturedBody = body
          return true
        })
        .reply(200, FAKE_AUDIO, { 'Content-Type': 'audio/mpeg' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      await adapter.audioSfx!({
        model: 'elevenlabs-sfx',
        prompt: 'rain on a tin roof',
        duration_seconds: 5,
      })

      expect(capturedBody.text).toBe('rain on a tin roof')
      expect(capturedBody.duration_seconds).toBe(5)
    })

    it('401 unusual activity maps to provider_invalid_request', async () => {
      nock(BASE)
        .post('/v1/sound-generation')
        .reply(401, error401Fx)

      const adapter = new ElevenLabsAdapter('el-test-key')
      await expect(
        adapter.audioSfx!({
          model: 'elevenlabs-sfx',
          prompt: 'rain',
          duration_seconds: 2,
        })
      ).rejects.toMatchObject({ code: 'provider_invalid_request' })
    })

    it('402 paid plan required maps to provider_invalid_request', async () => {
      nock(BASE)
        .post('/v1/sound-generation')
        .reply(402, error402Fx)

      const adapter = new ElevenLabsAdapter('el-test-key')
      await expect(
        adapter.audioSfx!({
          model: 'elevenlabs-sfx',
          prompt: 'rain',
          duration_seconds: 2,
        })
      ).rejects.toMatchObject({ code: 'provider_invalid_request' })
    })

    it('503 network error maps to provider_unavailable', async () => {
      nock(BASE)
        .post('/v1/sound-generation')
        .reply(503, { detail: 'Service unavailable' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      await expect(
        adapter.audioSfx!({
          model: 'elevenlabs-sfx',
          prompt: 'wind',
          duration_seconds: 1,
        })
      ).rejects.toMatchObject({ code: 'provider_unavailable' })
    })
  })

  // ---------------------------------------------------------------------------
  // audioSpeech (TTS)
  // ---------------------------------------------------------------------------
  describe('audioSpeech', () => {
    it('happy path returns sync bytes Buffer with default voice', async () => {
      nock(BASE)
        .post('/v1/text-to-speech/pNInz6obpgDQGcFmaJgB')
        .query({ output_format: 'mp3_44100_128' })
        .reply(200, FAKE_AUDIO, { 'Content-Type': 'audio/mpeg' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      const result = await adapter.audioSpeech!({
        model: 'elevenlabs-tts-v3',
        input: 'Hello, world!',
        voice: 'pNInz6obpgDQGcFmaJgB',
        response_format: 'mp3',
      })

      if (!('bytes' in result)) throw new Error('expected sync bytes result')
      expect(result.status).toBe('succeeded')
      expect(Buffer.isBuffer(result.bytes)).toBe(true)
      expect(result.mimeType).toBe('audio/mpeg')
      expect(result.provider).toBe('elevenlabs')
      expect(result.model).toBe('elevenlabs-tts-v3')
      expect(result.latency_ms).toBeGreaterThanOrEqual(0)
    })

    it('uses custom voice ID in URL path', async () => {
      nock(BASE)
        .post('/v1/text-to-speech/CwhRBWXzGAHq8TQ4Fs17')
        .query(true)
        .reply(200, FAKE_AUDIO, { 'Content-Type': 'audio/mpeg' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      const result = await adapter.audioSpeech!({
        model: 'elevenlabs-tts-v3',
        input: 'Testing Roger voice',
        voice: 'CwhRBWXzGAHq8TQ4Fs17',
        response_format: 'mp3',
      })

      if (!('bytes' in result)) throw new Error('expected sync bytes result')
      expect(result.status).toBe('succeeded')
    })

    it('sends eleven_v3 model and apply_text_normalization in body', async () => {
      let capturedBody: any
      nock(BASE)
        .post('/v1/text-to-speech/pNInz6obpgDQGcFmaJgB', body => {
          capturedBody = body
          return true
        })
        .query(true)
        .reply(200, FAKE_AUDIO, { 'Content-Type': 'audio/mpeg' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      await adapter.audioSpeech!({
        model: 'elevenlabs-tts-v3',
        input: 'Hello',
        voice: 'pNInz6obpgDQGcFmaJgB',
        response_format: 'mp3',
      })

      expect(capturedBody.text).toBe('Hello')
      expect(capturedBody.model_id).toBe('eleven_v3')
      expect(capturedBody.apply_text_normalization).toBe('auto')
    })

    it('resolves friendly name "adam" to voice_id pNInz6obpgDQGcFmaJgB', async () => {
      nock(BASE)
        .post('/v1/text-to-speech/pNInz6obpgDQGcFmaJgB')
        .query(true)
        .reply(200, FAKE_AUDIO, { 'Content-Type': 'audio/mpeg' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      const result = await adapter.audioSpeech!({
        model: 'elevenlabs-tts-v3',
        input: 'Hello',
        voice: 'adam',
        response_format: 'mp3',
      })

      if (!('bytes' in result)) throw new Error('expected sync bytes result')
      expect(result.status).toBe('succeeded')
    })

    it('resolves friendly name "Rachel" (case-insensitive) to voice_id 21m00Tcm4TlvDq8ikWAM', async () => {
      nock(BASE)
        .post('/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM')
        .query(true)
        .reply(200, FAKE_AUDIO, { 'Content-Type': 'audio/mpeg' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      const result = await adapter.audioSpeech!({
        model: 'elevenlabs-tts-v3',
        input: 'Hello',
        voice: 'Rachel',
        response_format: 'mp3',
      })

      if (!('bytes' in result)) throw new Error('expected sync bytes result')
      expect(result.status).toBe('succeeded')
    })

    it('maps OpenAI-style alias "alloy" to Adam voice_id', async () => {
      nock(BASE)
        .post('/v1/text-to-speech/pNInz6obpgDQGcFmaJgB')
        .query(true)
        .reply(200, FAKE_AUDIO, { 'Content-Type': 'audio/mpeg' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      const result = await adapter.audioSpeech!({
        model: 'elevenlabs-tts-v3',
        input: 'Hello',
        voice: 'alloy',
        response_format: 'mp3',
      })

      if (!('bytes' in result)) throw new Error('expected sync bytes result')
      expect(result.status).toBe('succeeded')
    })

    it('passes a raw voice_id through unchanged', async () => {
      nock(BASE)
        .post('/v1/text-to-speech/CwhRBWXzGAHq8TQ4Fs17')
        .query(true)
        .reply(200, FAKE_AUDIO, { 'Content-Type': 'audio/mpeg' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      const result = await adapter.audioSpeech!({
        model: 'elevenlabs-tts-v3',
        input: 'Hello',
        voice: 'CwhRBWXzGAHq8TQ4Fs17',
        response_format: 'mp3',
      })

      if (!('bytes' in result)) throw new Error('expected sync bytes result')
      expect(result.status).toBe('succeeded')
    })

    it('unknown voice name falls back to default Adam voice_id', async () => {
      nock(BASE)
        .post('/v1/text-to-speech/pNInz6obpgDQGcFmaJgB')
        .query(true)
        .reply(200, FAKE_AUDIO, { 'Content-Type': 'audio/mpeg' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      const result = await adapter.audioSpeech!({
        model: 'elevenlabs-tts-v3',
        input: 'Hello',
        voice: 'xyz-not-real',
        response_format: 'mp3',
      })

      if (!('bytes' in result)) throw new Error('expected sync bytes result')
      expect(result.status).toBe('succeeded')
    })

    it('empty voice falls back to default Adam voice_id', async () => {
      nock(BASE)
        .post('/v1/text-to-speech/pNInz6obpgDQGcFmaJgB')
        .query(true)
        .reply(200, FAKE_AUDIO, { 'Content-Type': 'audio/mpeg' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      const result = await adapter.audioSpeech!({
        model: 'elevenlabs-tts-v3',
        input: 'Hello',
        voice: '',
        response_format: 'mp3',
      })

      if (!('bytes' in result)) throw new Error('expected sync bytes result')
      expect(result.status).toBe('succeeded')
    })

    it('402 paid plan voice maps to provider_invalid_request', async () => {
      nock(BASE)
        .post('/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM')
        .query(true)
        .reply(402, error402Fx)

      const adapter = new ElevenLabsAdapter('el-test-key')
      await expect(
        adapter.audioSpeech!({
          model: 'elevenlabs-tts-v3',
          input: 'Hello',
          voice: '21m00Tcm4TlvDq8ikWAM',
          response_format: 'mp3',
        })
      ).rejects.toMatchObject({ code: 'provider_invalid_request' })
    })

    it('401 unusual activity maps to provider_invalid_request', async () => {
      nock(BASE)
        .post('/v1/text-to-speech/pNInz6obpgDQGcFmaJgB')
        .query(true)
        .reply(401, error401Fx)

      const adapter = new ElevenLabsAdapter('el-test-key')
      await expect(
        adapter.audioSpeech!({
          model: 'elevenlabs-tts-v3',
          input: 'Hello',
          voice: 'pNInz6obpgDQGcFmaJgB',
          response_format: 'mp3',
        })
      ).rejects.toMatchObject({ code: 'provider_invalid_request' })
    })

    // -------------------------------------------------------------------------
    // voice_settings forwarding — plugin parity
    // -------------------------------------------------------------------------

    it('forwards voice_settings object to POST body when provided', async () => {
      let capturedBody: any
      nock(BASE)
        .post('/v1/text-to-speech/pNInz6obpgDQGcFmaJgB', body => {
          capturedBody = body
          return true
        })
        .query(true)
        .reply(200, FAKE_AUDIO, { 'Content-Type': 'audio/mpeg' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      await adapter.audioSpeech!({
        model: 'elevenlabs-tts-v3',
        input: 'Hello with settings',
        voice: 'adam',
        response_format: 'mp3',
        voice_settings: {
          stability: 0.6,
          similarity_boost: 0.8,
          style: 0.1,
          speed: 1.1,
        },
      })

      expect(capturedBody.voice_settings).toBeDefined()
      expect(capturedBody.voice_settings.stability).toBe(0.6)
      expect(capturedBody.voice_settings.similarity_boost).toBe(0.8)
      expect(capturedBody.voice_settings.style).toBe(0.1)
      expect(capturedBody.voice_settings.speed).toBe(1.1)
    })

    it('omits voice_settings from POST body when not provided', async () => {
      let capturedBody: any
      nock(BASE)
        .post('/v1/text-to-speech/pNInz6obpgDQGcFmaJgB', body => {
          capturedBody = body
          return true
        })
        .query(true)
        .reply(200, FAKE_AUDIO, { 'Content-Type': 'audio/mpeg' })

      const adapter = new ElevenLabsAdapter('el-test-key')
      await adapter.audioSpeech!({
        model: 'elevenlabs-tts-v3',
        input: 'Hello without settings',
        voice: 'pNInz6obpgDQGcFmaJgB',
        response_format: 'mp3',
      })

      expect(capturedBody.voice_settings).toBeUndefined()
    })
  })
})
