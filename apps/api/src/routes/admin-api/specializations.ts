import type { FastifyInstance } from 'fastify'
import { prisma } from '@omniply/shared'
import { requireAdmin } from '../../middleware/admin'

interface CreateSpecializationBody {
  key?: string
  label?: string
  sortOrder?: number
  enabled?: boolean
  vertical?: string
}

interface UpdateSpecializationBody {
  label?: string
  sortOrder?: number
  enabled?: boolean
  vertical?: string
}

/** Normalise a free-text key into a stable slug (lowercase, underscores). */
function slugifyKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Admin specialization routes (mounted under /api/admin).
 * The specialization list is the DB-backed source of truth for the Settings
 * checkboxes (clients pick which they serve + one primary) and for routing each
 * client to the matching newsletter calendar.
 */
export async function specializationsAdminRoutes(app: FastifyInstance) {
  // GET /specializations — full list (admin manage view)
  app.get('/specializations', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return
    const specializations = await prisma.specialization.findMany({
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    })
    return reply.send({ specializations })
  })

  // POST /specializations — create
  app.post<{ Body: CreateSpecializationBody }>('/specializations', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return

    const { label, sortOrder, enabled } = request.body ?? {}
    if (!label?.trim()) return reply.status(400).send({ error: 'label is required' })
    const key = slugifyKey(request.body?.key?.trim() || label)
    if (!key) return reply.status(400).send({ error: 'key could not be derived from label' })

    const existing = await prisma.specialization.findUnique({ where: { key } })
    if (existing) return reply.status(409).send({ error: `specialization "${key}" already exists` })

    const vertical = request.body?.vertical
    if (vertical !== undefined && !['chiro', 'wellness', 'all'].includes(vertical)) {
      return reply.status(400).send({ error: "vertical must be 'chiro', 'wellness' or 'all'" })
    }
    const specialization = await prisma.specialization.create({
      data: {
        key,
        label: label.trim(),
        sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
        enabled: enabled ?? true,
        ...(vertical !== undefined ? { vertical } : {}),
      },
    })
    return reply.status(201).send({ specialization })
  })

  // PATCH /specializations/:id — update label/order/enabled (key is immutable)
  app.patch<{ Params: { id: string }; Body: UpdateSpecializationBody }>(
    '/specializations/:id',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply)
      if (!admin) return

      const existing = await prisma.specialization.findUnique({ where: { id: request.params.id } })
      if (!existing) return reply.status(404).send({ error: 'Specialization not found' })

      const { label, sortOrder, enabled, vertical } = request.body ?? {}
      if (vertical !== undefined && !['chiro', 'wellness', 'all'].includes(vertical)) {
        return reply.status(400).send({ error: "vertical must be 'chiro', 'wellness' or 'all'" })
      }
      const specialization = await prisma.specialization.update({
        where: { id: request.params.id },
        data: {
          ...(label !== undefined ? { label: label.trim() } : {}),
          ...(sortOrder !== undefined ? { sortOrder } : {}),
          ...(enabled !== undefined ? { enabled } : {}),
          ...(vertical !== undefined ? { vertical } : {}),
        },
      })
      return reply.send({ specialization })
    },
  )

  // DELETE /specializations/:id — only when no calendar references the key
  app.delete<{ Params: { id: string } }>('/specializations/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply)
    if (!admin) return

    const existing = await prisma.specialization.findUnique({ where: { id: request.params.id } })
    if (!existing) return reply.status(404).send({ error: 'Specialization not found' })

    const calendarsUsing = await prisma.newsletterCalendar.count({
      where: { specializationKey: existing.key },
    })
    if (calendarsUsing > 0) {
      return reply.status(409).send({
        error: `Cannot delete: ${calendarsUsing} calendar(s) still use this specialization. Disable it instead.`,
      })
    }

    await prisma.specialization.delete({ where: { id: request.params.id } })
    return reply.send({ ok: true })
  })
}
