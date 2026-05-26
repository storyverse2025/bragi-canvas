import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import submitFx from '../fixtures/apimart/submit-success.json' with { type: 'json' }
import taskCompletedFx from '../fixtures/apimart/task-completed.json' with { type: 'json' }
import errorFx from '../fixtures/apimart/error-400.json' with { type: 'json' }
import { ApimartAdapter } from '../../src/adapters/apimart.js'

const BASE = 'https://api.apimart.ai'

afterEach(() => {
  nock.cleanAll()
})

describe('ApimartAdapter', () => {
  it('imageGeneration submits task and returns AsyncResult', async () => {
    nock(BASE)
      .post('/v1/images/generations')
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.imageGeneration!({
      model: 'gpt-image-2',
      prompt: 'a beautiful landscape',
      n: 1,
      size: '1024x1024',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('apimart')
    expect(result.provider_task_id).toBe('apimart-task-abc123')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus returns succeeded with image output on completion', async () => {
    nock(BASE)
      .get('/v1/tasks/apimart-task-abc123')
      .reply(200, taskCompletedFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.taskStatus!('apimart-task-abc123')

    expect(result.status).toBe('succeeded')
    expect(result.outputs).toBeDefined()
    expect(result.outputs![0].kind).toBe('image')
    expect(result.outputs![0].url).toContain('gpt-image-result-abc123.png')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('taskStatus returns running for pending status', async () => {
    nock(BASE)
      .get('/v1/tasks/apimart-task-pending')
      .reply(200, { data: { status: 'pending', task_id: 'apimart-task-pending' } })

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.taskStatus!('apimart-task-pending')

    expect(result.status).toBe('running')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus returns failed on failed status', async () => {
    nock(BASE)
      .get('/v1/tasks/apimart-task-fail')
      .reply(200, {
        data: { status: 'failed', error: { message: 'Content policy violation' } },
      })

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.taskStatus!('apimart-task-fail')

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('provider_rejected')
  })

  it('imageGeneration sends correct model name and size', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'gpt-image-2',
      prompt: 'test',
      n: 1,
      size: '1024x1024',
    })

    expect(capturedBody.model).toBe('gpt-image-2')
    expect(capturedBody.resolution).toBe('2k')
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post('/v1/images/generations')
      .reply(400, errorFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await expect(
      adapter.imageGeneration!({
        model: 'gpt-image-2',
        prompt: 'bad request',
        n: 1,
        size: '1024x1024',
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })

  it('network failure on imageGeneration maps to provider_unavailable 503', async () => {
    nock(BASE)
      .post('/v1/images/generations')
      .replyWithError('ECONNREFUSED')

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await expect(
      adapter.imageGeneration!({
        model: 'gpt-image-2',
        prompt: 'test',
        n: 1,
        size: '1024x1024',
      })
    ).rejects.toMatchObject({ code: 'provider_unavailable', httpStatus: 503 })
  })

  it('network failure on taskStatus maps to provider_unavailable 503', async () => {
    nock(BASE)
      .get('/v1/tasks/apimart-task-net-fail')
      .replyWithError('ETIMEDOUT')

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await expect(
      adapter.taskStatus!('apimart-task-net-fail')
    ).rejects.toMatchObject({ code: 'provider_unavailable', httpStatus: 503 })
  })
})
