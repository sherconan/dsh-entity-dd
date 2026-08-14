/**
 * Renders search results for the model.
 *
 * Two product rules are enforced here, and they are the reason this plugin
 * exists rather than returning the register's raw JSON:
 *
 *   1. Multiple candidates are a FINDING, not a list. A trading name commonly
 *      maps to several legal persons across jurisdictions, and picking the wrong
 *      one is the single most expensive mistake in cross-border contracting.
 *   2. A record's age decides whether it may be relied on. An entity can be
 *      perfectly alive while its register record has gone unmaintained for years.
 *
 * Freshness here runs through the SAME rule set as the full dossier, so a
 * candidate flagged in search can never come back clean in its dossier.
 */

import { buildFacts, assess } from './assess.js'
import { countryName } from './countries.js'

const ICON = { red: '⛔', amber: '⚠️', info: 'ℹ️', clear: '✅' }

/** One-line status for a candidate, derived from the shared rule set. */
function statusLine(entity) {
  const { findings, worst } = assess(buildFacts(entity))
  if (worst === 'clear') return `${ICON.clear} 登记记录在维护中，未触发风险规则。`
  const top = findings.find((f) => f.level === worst) ?? findings[0]
  const more = findings.length > 1 ? `（另有 ${findings.length - 1} 条提示）` : ''
  return `${ICON[worst]} ${top.label} — ${top.finding}${more}`
}

function renderOne(entity, index) {
  return [
    `${index}. ${entity.legalName ?? '(无名称)'}`,
    `   注册地    ${countryName(entity.country)}${entity.city ? ` · ${entity.city}` : ''}${entity.street ? ` · ${entity.street}` : ''}`,
    `   本国登记号 ${entity.registeredAs ?? '未提供'}`,
    `   全球识别码 ${entity.lei}`,
    `   ${statusLine(entity)}`,
  ].join('\n')
}

/**
 * Build the model-facing result for one search.
 */
export function formatCandidates(query, { candidates, suggestions, error }) {
  if (error) {
    return [
      `查询「${query}」失败：${error}`,
      '',
      '这是取数环节的故障，不代表该公司有问题，也不代表它不存在。',
      '请如实告知用户查询未能完成，不要基于已有知识编造该公司的登记信息。',
    ].join('\n')
  }

  if (candidates.length === 0) {
    const out = [
      `未在全球法人识别码库中找到与「${query}」匹配的主体。`,
      '',
      '重要：查不到本身不是风险信号。该库只收录办理过全球法人识别码的法人，',
      '以金融市场活跃的中大型企业为主；大量正常经营的中小企业并未登记。',
    ]
    if (suggestions.length) {
      out.push(
        '',
        '库中存在以下名称相近的主体，请向用户确认是否指其中之一（不要自行替用户选定）：',
        ...suggestions.map((s) => `  · ${s}`),
      )
    }
    out.push(
      '',
      '建议的下一步（请向用户说明，不要自行编造登记信息）：',
      '  1. 向对方索取近 6 个月内的商业登记摘录原件；',
      '  2. 若对方在欧盟境内，取得其增值税号后可用 entity_vat_check 做官方实时核验——',
      '     中小企业往往没有全球识别码，但一定有增值税号；',
      '  3. 换用对方的英文法定全称或登记号重新查询。中国主体通常以中文法定名登记，可直接用中文查；',
      '     欧陆、日韩等主体多以拉丁转写名登记，用中文或本地文字往往查不到。',
    )
    return out.join('\n')
  }

  const header = [`查询「${query}」在全球法人识别码库中命中 ${candidates.length} 个法人主体。`]

  if (candidates.length > 1) {
    const countries = [...new Set(candidates.map((c) => c.country).filter(Boolean))]
    header.push(
      '',
      '⚠️ 主体消歧：该名称对应多个彼此独立的法人' +
        (countries.length > 1 ? `，分布在 ${countries.map(countryName).join('、')}` : '') +
        '。',
      '它们是不同的责任主体：与其中一家签约，不能向另一家追责。',
      '在继续之前，必须请用户确认合同抬头上写的是哪一个，不要替用户选定。',
    )
  }

  return [
    ...header,
    '',
    candidates.map((c, i) => renderOne(c, i + 1)).join('\n\n'),
    '',
    `选定主体后，用 entity_dossier 传入其全球识别码，可取得完整档案、集团关系、风险提示与数据体检表。`,
    '数据来源：全球法人识别码基金会（GLEIF）公开库，每日更新。',
    '本结果仅为登记信息核对，不构成合规结论或法律意见。',
  ].join('\n')
}
