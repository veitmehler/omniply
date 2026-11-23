import type { FastifyInstance } from 'fastify'
import { llmKeysAdminRoutes } from './llm-keys'
import { costsAdminRoutes } from './costs'
import { usersAdminRoutes } from './users'
import { errorsAdminRoutes } from './errors'
import { articlesAdminRoutes } from './articles'
import { promptsAdminRoutes } from './prompts'
import { outlineFrameworksAdminRoutes } from './outline-frameworks'
import { socialAutomationAdminRoutes } from './social-automation'
import { musicAdminRoutes } from './music'
import { newslettersAdminRoutes } from './newsletters'
import { specializationsAdminRoutes } from './specializations'
import { articleCalendarsAdminRoutes } from './article-calendars'
import { accountsAdminRoutes } from './accounts'
import { leadgenTemplatesAdminRoutes } from './leadgen-templates'
import { agentConversationsAdminRoutes } from './agent-conversations'
import { systemHealthAdminRoutes } from './system-health'

export async function adminApiRoutes(app: FastifyInstance) {
  await app.register(llmKeysAdminRoutes)
  await app.register(costsAdminRoutes)
  await app.register(usersAdminRoutes)
  await app.register(accountsAdminRoutes)
  await app.register(errorsAdminRoutes)
  await app.register(articlesAdminRoutes)
  await app.register(promptsAdminRoutes)
  await app.register(outlineFrameworksAdminRoutes)
  await app.register(socialAutomationAdminRoutes)
  await app.register(musicAdminRoutes)
  await app.register(newslettersAdminRoutes)
  await app.register(specializationsAdminRoutes)
  await app.register(articleCalendarsAdminRoutes)
  await app.register(leadgenTemplatesAdminRoutes)
  await app.register(agentConversationsAdminRoutes)
  await app.register(systemHealthAdminRoutes)
}
