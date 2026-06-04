import { z } from 'zod'

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
})

export const ChatCompletionsBody = z.discriminatedUnion('model', [
  z.object({
    model: z.literal('gpt-5.5-pro'),
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
  z.object({
    model: z.literal('gpt-5.5'),
    messages: z.array(MessageSchema),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().default(false),
  }),
  z.object({
    model: z.literal('gemini-3.5-flash'),
    messages: z.array(MessageSchema),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().default(false),
  }),
  z.object({
    model: z.literal('claude-opus-4-7'),
    messages: z.array(MessageSchema),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().default(false),
  }),
  z.object({
    model: z.literal('claude-sonnet-4-6'),
    messages: z.array(MessageSchema),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().default(false),
  }),
  z.object({
    model: z.literal('grok-4-3'),
    messages: z.array(MessageSchema),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().default(false),
  }),
  z.object({
    model: z.literal('grok-4-fast'),
    messages: z.array(MessageSchema),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().default(false),
  }),
])

export type ChatCompletionsRequest = z.infer<typeof ChatCompletionsBody>
