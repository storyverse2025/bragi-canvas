import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import taskCompletedFx from '../fixtures/legnext/task-completed.json' with { type: 'json' }
import { LegnextAdapter } from '../../src/adapters/legnext.js'

const BASE = 'https://api.legnext.com'

afterEach(() => {
  nock.cleanAll()
})

describe('LegnextAdapter', () => {
  it('imageGeneration throws unknown_model (midjourney not supported in V1)', async () => {
    const adapter = new LegnextAdapter('legnext-test-key')
    await expect(
      adapter.imageGeneration!({
        model: 'midjourney-v8',
        prompt: 'a beautiful landscape painting',
        quality: 'medium',
      })
    ).rejects.toMatchObject({ code: 'unknown_model' })
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
})
