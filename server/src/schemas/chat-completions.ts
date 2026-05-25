import { z } from 'zod'

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
})

export const ChatCompletionsBody = z.discriminatedUnion('model', [
  z.object({
    model: z.literal('gpt-5.4-pro'),
    messages: z.array(MessageSchema),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
    stream: z.boolean().default(false),
  }),
  z.object({
    model: z.enum(['gemini-3-flash', 'gemini-3.1-pro']),
    messages: z.array(MessageSchema),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().default(false),
  }),
  z.object({
    model: z.literal('qwen-3-6-plus'),
    messages: z.array(MessageSchema),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().default(false),
  }),
])

export type ChatCompletionsRequest = z.infer<typeof ChatCompletionsBody>
