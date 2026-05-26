import 'dotenv/config'
import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.string().default('8787').transform(Number),
  ROUTER_PUBLIC_URL: z.string().url(),
  ASSET_TTL_SECONDS: z.string().default('3600').transform(Number),
  ASSET_SIGNING_SECRET: z.string().min(16),
  ASSET_TMP_DIR: z.string().default('./tmp'),
  BRAGI_TOKENS: z.string().transform(s => new Set(s.split(',').map(t => t.trim()).filter(Boolean))),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  BYTEPLUS_API_KEY: z.string().optional(),
  BYTEPLUS_ACCESS_KEY: z.string().optional(),
  BYTEPLUS_SECRET_KEY: z.string().optional(),
  BYTEPLUS_PROJECT: z.string().optional(),
  FAL_API_KEY: z.string().optional(),
  LUMA_TOKEN: z.string().optional(),
  LUMA_PROXY_BEARER_TOKEN: z.string().optional(),
  LUMA_PROXY_BASE_URL: z.string().optional().default('https://luma.bragi.now'),
  XAI_API_KEY: z.string().optional(),
  LEGNEXT_API_KEY: z.string().optional(),
  TOKENROUTER_API_KEY: z.string().optional(),
  APIMART_API_KEY: z.string().optional(),
  APIMART_BASE_URL: z.string().optional().default('https://api.apimart.ai'),
})

export const env = EnvSchema.parse(process.env)
export type Env = z.infer<typeof EnvSchema>
