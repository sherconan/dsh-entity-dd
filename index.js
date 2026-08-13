import { defineTool } from '@deepseek-ai/dsh-tools'
import { searchEntities } from './lib/gleif.js'
import { formatCandidates } from './lib/format.js'

export const name = 'entity-dd'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'entity_search',
    description: [
      'Find the legal entities that match a company name, so the caller can identify',
      'WHICH legal person a contract is actually with. A trading name often maps to',
      'several distinct registered entities in different jurisdictions; this tool',
      'surfaces all of them instead of silently picking one.',
      'Returns each candidate with its national business-register number and how stale',
      'the record is. Never invent an entity that is not returned here.',
    ].join(' '),
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'Company name as the user gave it. Latin script matches best; a local-language name may return nothing.',
      },
      // Optional parameters must omit `required` entirely — the schema compiler
      // rejects `required: false`.
      country: {
        type: 'string',
        description: 'Optional ISO 3166-1 alpha-2 country code (e.g. DE, US, HK) to narrow the search.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = await searchEntities(args.name, args.country)
      return formatCandidates(args.name, result)
    },
  }))
}
