export interface AdapterOutputItem {
  kind: 'image' | 'video' | 'text' | 'audio'
  url?: string
  text?: string
  mime_type?: string
}

export interface SyncResult {
  status: 'succeeded'
  outputs: AdapterOutputItem[]
  provider: string
  model: string
  latency_ms: number
}

export interface AsyncResult {
  status: 'queued'
  provider: string
  provider_task_id: string
  poll_after_ms: number
}

export interface TaskStatusResult {
  status: 'running' | 'succeeded' | 'failed'
  outputs?: AdapterOutputItem[]
  error?: { code: string; message: string; provider_raw?: unknown }
  latency_ms?: number
  poll_after_ms?: number
}

export interface Adapter {
  readonly name: string
  chatCompletion?(req: any): Promise<SyncResult>
  imageGeneration?(req: any): Promise<SyncResult | AsyncResult>
  videoGeneration?(req: any): Promise<AsyncResult>
  audioSpeech?(req: any): Promise<{ status: 'succeeded'; bytes: Buffer; mimeType: string; latency_ms: number; provider: string; model: string } | AsyncResult>
  audioMusic?(req: any): Promise<AsyncResult>
  audioSfx?(req: any): Promise<{ status: 'succeeded'; bytes: Buffer; mimeType: string; latency_ms: number; provider: string; model: string } | AsyncResult>
  taskStatus?(taskId: string): Promise<TaskStatusResult>
}
