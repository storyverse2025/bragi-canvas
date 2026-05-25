import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import imageSubmitFx from '../fixtures/legnext/image-submit.json' with { type: 'json' }
import taskCompletedFx from '../fixtures/legnext/task-completed.json' with { type: 'json' }
import errorFx from '../fixtures/legnext/error-400.json' with { type: 'json' }
import { LegnextAdapter } from '../../src/adapters/legnext.js'

const BASE = 'https://api.legnext.com'

afterEach(() => {
  nock.cleanAll()
})

describe('LegnextAdapter', () => {
  it('imageGeneration happy path returns AsyncResult with provider_task_id', async () => {
    nock(BASE)
      .post('/v1/imagine')
      .reply(200, imageSubmitFx)

    const adapter = new LegnextAdapter('legnext-test-key')
    const result = await adapter.imageGeneration!({
      model: 'midjourney-v8',
      prompt: 'a beautiful landscape painting',
      quality: 'medium',
    })

    if (result.status !== 'queued') throw new Error(`expected queued, got ${result.status}`)
    expect(result.status).toBe('queued')
    expect(result.provider).toBe('legnext')
    expect(result.provider_task_id).toBe(imageSubmitFx.task_id)
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus for completed task returns succeeded with image output', async () => {
    const taskId = 'legnext-task-abc123'

    nock(BASE)
      .get(`/v1/tasks/${taskId}`)
      .reply(200, taskCompletedFx)

    const adapter = new LegnextAdapter('legnext-test-key')
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('succeeded')
    expect(result.outputs).toBeDefined()
    expect(result.outputs!).toHaveLength(1)
    expect(result.outputs![0].kind).toBe('image')
    expect(result.outputs![0].url).toContain('mj-result-abc123.png')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post('/v1/imagine')
      .reply(400, errorFx)

    const adapter = new LegnextAdapter('legnext-test-key')
    await expect(
      adapter.imageGeneration!({
        model: 'midjourney-v8',
        prompt: 'bad request',
        quality: 'low',
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })
})
