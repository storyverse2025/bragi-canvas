import { Hono } from 'hono'

export const authRoute = new Hono()

authRoute.post('/check', c => {
  const token = c.get('bragiToken') as string
  return c.json({ ok: true, label: token })
})
