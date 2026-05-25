import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import videoSubmitFx from '../fixtures/luma/video-submit.json' with { type: 'json' }
import taskCompletedFx from '../fixtures/luma/task-completed.json' with { type: 'json' }
import errorFx from '../fixtures/luma/error-400.json' with { type: 'json' }
import { LumaAdapter } from '../../src/adapters/luma.js'

const BASE = 'https://api.lumalabs.ai'

afterEach(() => {
  nock.cleanAll()
})

describe('LumaAdapter', () => {
  it('videoGeneration happy path returns AsyncResult with provider_task_id', async () => {
    nock(BASE)
      .post('/dream-machine/v1/generations')
      .reply(200, videoSubmitFx)

    const adapter = new LumaAdapter('luma-test-token')
    const result = await adapter.videoGeneration!({
      model: 'luma-uni-1',
      prompt: 'a cinematic sunset over the ocean',
      aspectRatio: '16:9',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('luma')
    expect(result.provider_task_id).toBe(videoSubmitFx.id)
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus for completed task returns succeeded with video output', async () => {
    const taskId = 'luma-task-abc123'

    nock(BASE)
      .get(`/dream-machine/v1/generations/${taskId}`)
      .reply(200, taskCompletedFx)

    const adapter = new LumaAdapter('luma-test-token')
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('succeeded')
    expect(result.outputs).toBeDefined()
    expect(result.outputs!).toHaveLength(1)
    expect(result.outputs![0].kind).toBe('video')
    expect(result.outputs![0].url).toContain('luma-result-abc123.mp4')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post('/dream-machine/v1/generations')
      .reply(400, errorFx)

    const adapter = new LumaAdapter('luma-test-token')
    await expect(
      adapter.videoGeneration!({
        model: 'luma-uni-1',
        prompt: 'bad request',
        aspectRatio: '16:9',
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })
})
