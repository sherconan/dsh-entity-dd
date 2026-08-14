import { defineTool } from '@deepseek-ai/dsh-tools'
import { searchEntities } from './lib/gleif.js'
import { formatCandidates } from './lib/format.js'
import { buildDossier } from './lib/dossier.js'
import { checkVat } from './lib/vies.js'
import { countryName } from './lib/countries.js'

export const name = 'entity-dd'
export const inject = ['tools']

export function apply(ctx) {
  // ---- 1. Resolve WHICH legal person is meant -----------------------------
  ctx.tools.register(defineTool({
    name: 'entity_search',
    description: [
      'Find the legal entities that match a company name, so the caller can identify',
      'WHICH legal person a contract is actually with. A trading name often maps to',
      'several distinct registered entities in different jurisdictions; this tool',
      'surfaces all of them instead of silently picking one.',
      'Always run this before entity_dossier. Never invent an entity that is not returned here.',
    ].join(' '),
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'Company name as the user gave it. Chinese entities are usually registered under their Chinese legal name; European and East Asian entities under a Latin transliteration.',
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
      return formatCandidates(args.name, await searchEntities(args.name, args.country))
    },
  }))

  // ---- 2. Judge whether that entity's record may be relied on -------------
  ctx.tools.register(defineTool({
    name: 'entity_dossier',
    description: [
      'Produce a due-diligence dossier for ONE specific legal entity, identified by its',
      'LEI (obtain it from entity_search first — do not guess an LEI).',
      'Returns the registered particulars, group structure, risk findings, and a',
      'field-by-field data inspection table stating each value\'s as-of date, source and',
      'confidence, plus an explicit verdict on whether the record may be relied on for',
      'contracting. Report its verdict and caveats to the user; do not overstate them.',
    ].join(' '),
    parameters: {
      lei: {
        type: 'string',
        required: true,
        description: 'The 20-character Legal Entity Identifier of the chosen entity.',
      },
      vat: {
        type: 'string',
        description: 'Optional EU VAT number for live cross-validation against the member state tax authority, e.g. DE811907980.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return buildDossier(args.lei, { vat: args.vat })
    },
  }))

  // ---- 3. The fallback when the entity has no LEI at all ------------------
  ctx.tools.register(defineTool({
    name: 'entity_vat_check',
    description: [
      'Validate an EU VAT number in real time against the member state\'s own tax',
      'administration (EU VIES). Use this for small and mid-sized EU counterparties,',
      'which frequently have no LEI and therefore cannot be found by entity_search.',
      'Some member states disclose validity only and withhold the trader name;',
      'a withheld name is not a failed check.',
    ].join(' '),
    parameters: {
      vat: {
        type: 'string',
        required: true,
        description: 'VAT number, with or without its country prefix, e.g. DE811907980 or 811907980.',
      },
      country: {
        type: 'string',
        description: 'Country code, required only when the VAT number carries no prefix.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = await checkVat(args.vat, args.country)
      const head = `增值税号核验：${result.country ?? ''}${result.number ?? args.vat}`
      switch (result.status) {
        case 'valid':
          return [
            `${head} — ✅ 有效`,
            `核验时间：${(result.checkedAt ?? '').slice(0, 19) || '刚刚'}（成员国税务机关实时应答）`,
            result.name
              ? `纳税人名称：${result.name}${result.address ? `\n登记地址：${result.address}` : ''}`
              : '该成员国仅返回有效性，不披露纳税人名称与地址——这是其披露政策，不是核验失败。',
            '',
            '含义：该号码当前在欧盟增值税系统中有效。这证明主体存在且税务登记在册，',
            '但不证明其经营状况、履约能力或与你洽谈之人确有代表权。',
          ].filter(Boolean).join('\n')
        case 'invalid':
          return [
            `${head} — ⛔ 无效`,
            '',
            '该号码未在欧盟增值税系统中登记为有效。可能原因：抄写有误、已注销、',
            '或对方提供了并不属于自己的号码。请要求对方书面确认后重新核验，不要直接推进交易。',
          ].join('\n')
        case 'unavailable':
          return `${head} — ⚠️ 暂时无法核验\n${result.detail}`
        case 'unsupported':
          return `${head} — 不适用\n${result.detail}\n非欧盟主体请改用 entity_search 按名称检索，或直接索取当地登记摘录。`
        default:
          return `${head} — ⚠️ 核验未完成\n${result.detail}\n请如实告知用户，不要据此做出任何判断。`
      }
    },
  }))
}
