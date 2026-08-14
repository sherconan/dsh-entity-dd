/**
 * Turns register fields into judgements.
 *
 * The rules themselves live in ../rules/risk-rules.json as readable data, not
 * code, so a user can inspect exactly why a warning fired and edit the
 * thresholds for their own risk appetite. This module only computes the facts
 * those rules are written against, and applies them.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RULES = JSON.parse(
  readFileSync(fileURLToPath(new URL('../rules/risk-rules.json', import.meta.url)), 'utf8'),
)

/** Jurisdictions that commonly host holding or conduit vehicles. */
const OFFSHORE = new Set([
  'KY', 'VG', 'BM', 'PA', 'SC', 'BS', 'JE', 'GG', 'IM', 'AI', 'CW', 'MH', 'BZ', 'LI',
])

/** Address shapes that suggest a registered-agent or mail-drop rather than premises. */
const AGENT_ADDRESS = /\b(c\/o|care of|p\.?\s?o\.?\s?box|postfach|boîte postale|casilla)\b|℅/i

/** Whole years between an ISO date and now; null when unparseable. */
function yearsSince(iso) {
  if (!iso) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  return (Date.now() - then) / (365.25 * 24 * 3600 * 1000)
}

/**
 * Compute the fact sheet the rules are evaluated against.
 * @param entity flattened GLEIF record
 * @param relations {directParent?: object|null, ultimateParent?: object|null}
 */
export function buildFacts(entity, relations = {}) {
  const { directParent = null } = relations
  const overdue = yearsSince(entity.nextRenewal)
  return {
    entityStatus: entity.entityStatus,
    recordStatus: entity.recordStatus,
    recordAgeYears: yearsSince(entity.lastUpdate),
    // Only a positive value means overdue; a future renewal date yields null.
    renewalOverdueYears: overdue !== null && overdue > 0 ? overdue : null,
    country: entity.country,
    isOffshore: OFFSHORE.has(entity.country),
    registeredAs: entity.registeredAs,
    hasDirectParent: Boolean(directParent),
    parentCountry: directParent?.country ?? null,
    parentIsOffshore: Boolean(directParent && OFFSHORE.has(directParent.country)),
    parentCountryDiffers: Boolean(
      directParent?.country && entity.country && directParent.country !== entity.country,
    ),
    addressLooksLikeAgent: AGENT_ADDRESS.test(entity.street ?? ''),
  }
}

/** Evaluate one rule condition against the fact sheet. */
function matches(condition, facts) {
  const actual = facts[condition.field]
  switch (condition.op) {
    case 'in':
      return actual !== null && actual !== undefined && condition.value.includes(actual)
    case 'notIn':
      return actual !== null && actual !== undefined && !condition.value.includes(actual)
    case 'eq':
      return actual === condition.value
    case 'gt':
      return typeof actual === 'number' && actual > condition.value
    case 'isTrue':
      return actual === true
    case 'isFalse':
      return actual === false
    case 'isNull':
      return actual === null || actual === undefined || actual === ''
    case 'notNull':
      return actual !== null && actual !== undefined && actual !== ''
    default:
      // An unknown operator must never silently pass as "no risk".
      throw new Error(`风险规则 ${condition.field} 使用了未知的判定操作符：${condition.op}`)
  }
}

/** Reduce a set of findings to their most severe level. */
function severity(findings) {
  if (findings.some((f) => f.level === 'red')) return 'red'
  if (findings.some((f) => f.level === 'amber')) return 'amber'
  return findings.length ? 'info' : 'clear'
}

/**
 * Apply every rule, then drop findings that a more specific finding supersedes.
 *
 * `worst` covers everything; `dataWorst` covers only the data-quality dimension.
 * They are reported separately on purpose: an entity registered offshore is a
 * business concern, not a reason to distrust the freshness of its record, and
 * collapsing the two would make the inspection table meaningless.
 *
 * @returns {{findings: object[], worst: string, dataWorst: string}}
 */
export function assess(facts) {
  const fired = RULES.rules.filter((rule) => matches(rule.when, facts))
  const suppressed = new Set(fired.flatMap((rule) => rule.suppresses ?? []))
  const findings = fired
    .filter((rule) => !suppressed.has(rule.id))
    .map(({ id, level, dimension, label, finding, advice }) => ({
      id, level, dimension, label, finding, advice,
    }))

  return {
    findings,
    worst: severity(findings),
    dataWorst: severity(findings.filter((f) => f.dimension === 'data')),
  }
}

/** The one-line verdict on whether this record may be relied upon. */
export function verdict(worst) {
  switch (worst) {
    case 'red':
      return {
        usable: '不可作为签约依据',
        why: '存在阻断性问题，须先澄清主体本身。',
      }
    case 'amber':
      return {
        usable: '不可单独作为签约依据',
        why: '需对方补充近期登记材料后方可采信。',
      }
    case 'info':
      return {
        usable: '可作初步参考',
        why: '未发现阻断性问题，但存在需留意的背景情况。',
      }
    default:
      return {
        usable: '可作初步参考',
        why: '登记记录在维护中，未触发风险规则。仍建议签约前索取一份近期登记摘录。',
      }
  }
}

export const rulesMeta = { version: RULES.version, updated: RULES.updated, count: RULES.rules.length }
