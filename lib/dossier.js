/**
 * Assembles the entity dossier — the plugin's main deliverable.
 *
 * Three things distinguish this from dumping the register's JSON:
 *   1. it leads with whether the record may be RELIED ON, not with the data;
 *   2. every field carries its own as-of date, source and confidence, so a
 *      reader can see which numbers are fresh and which are three years old;
 *   3. when a second source is available it is cross-checked, and a mismatch
 *      is reported rather than quietly resolved.
 */

import {
  getEntity,
  getRelatedEntity,
  countDirectChildren,
  getRegistrationAuthority,
} from './gleif.js'
import { checkVat } from './vies.js'
import { buildFacts, assess, verdict, rulesMeta } from './assess.js'
import { countryName } from './countries.js'

const ICON = { red: '⛔', amber: '⚠️', info: 'ℹ️' }

/**
 * Confidence mark for a field sourced from the LEI record itself.
 * Driven by the DATA dimension only: whether the record is fresh and complete.
 * Business risks (offshore, agent address) belong in 风险提示, not here — a
 * two-day-old record about a Cayman fund is still a two-day-old record.
 */
function recordConfidence(dataWorst) {
  return dataWorst === 'clear' ? '✅' : dataWorst === 'red' ? '⛔' : '⚠️'
}

const dateOnly = (iso) => (iso ? String(iso).slice(0, 10) : '—')

/**
 * Gather every source for one LEI. Network failures degrade to null rather than
 * aborting: a dossier missing its group structure is still worth reading, and
 * the table says which parts are missing.
 */
async function gather(lei, vat, vatCountry) {
  const entity = await getEntity(lei)
  if (!entity) return null

  const settle = (promise) => promise.then((v) => v, () => null)
  const [directParent, ultimateParent, childCount, authority, vatResult] = await Promise.all([
    settle(getRelatedEntity(lei, 'direct-parent')),
    settle(getRelatedEntity(lei, 'ultimate-parent')),
    settle(countDirectChildren(lei)),
    settle(getRegistrationAuthority(entity.registrationAuthorityCode)),
    vat ? settle(checkVat(vat, vatCountry ?? entity.country)) : Promise.resolve(null),
  ])

  return { entity, directParent, ultimateParent, childCount, authority, vatResult }
}

/**
 * Compare the trader name the tax authority returned against the register's
 * legal name. Only a genuine disagreement is reported — a withheld name is not
 * a mismatch, and neither is a difference in legal-form suffix or case.
 */
function crossCheckName(registerName, viesName) {
  if (!registerName || !viesName) return null
  const normalise = (s) =>
    s
      .toLowerCase()
      .replace(/[.,''"()]/g, '')
      .replace(/\b(gmbh|ag|se|kg|ohg|bv|nv|sa|srl|spa|sarl|oy|ab|as|aps|ltd|limited|plc|inc|llc|co|company)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  const a = normalise(registerName)
  const b = normalise(viesName)
  if (!a || !b) return null
  if (a === b || a.includes(b) || b.includes(a)) return { agree: true }
  return { agree: false, registerName, viesName }
}

function renderTable(rows) {
  return [
    '| 字段 | 值 | 截至 | 来源 | 采信 |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.field} | ${r.value} | ${r.asOf} | ${r.source} | ${r.mark} |`),
  ].join('\n')
}

/**
 * Build the full dossier text.
 * @returns {Promise<string>} model-facing markdown
 */
export async function buildDossier(lei, { vat, vatCountry } = {}) {
  let data
  try {
    data = await gather(lei, vat, vatCountry)
  } catch (error) {
    return [
      `无法生成实体档案：${error.message}`,
      '',
      '这是取数环节的故障，不代表该主体有问题。请如实告知用户查询未能完成，',
      '不要基于已有知识补全该主体的登记信息。',
    ].join('\n')
  }

  if (!data) {
    return [
      `全球法人识别码库中不存在识别码 ${lei} 对应的记录。`,
      '',
      '请确认该识别码是否抄写正确（20 位字母数字），或改用 entity_search 按名称检索。',
    ].join('\n')
  }

  const { entity, directParent, ultimateParent, childCount, authority, vatResult } = data
  const facts = buildFacts(entity, { directParent, ultimateParent })
  const { findings, worst, dataWorst } = assess(facts)
  const call = verdict(worst)
  const mark = recordConfidence(dataWorst)
  const asOf = dateOnly(entity.lastUpdate)

  // Some authorities carry only one of the two names, and a few carry neither;
  // fall back through them so the dossier never prints "null".
  const authorityLabel = (() => {
    const local = authority?.localName || null
    const international = authority?.internationalName || null
    if (local && international && local !== international) return `${local}（${international}）`
    if (local || international) return local ?? international
    return entity.registrationAuthorityCode ?? '未提供'
  })()

  // ---- 结论 --------------------------------------------------------------
  const out = [
    `# 实体档案：${entity.legalName ?? '(无名称)'}`,
    '',
    '## 结论',
    `- **能否采信**：${call.usable}`,
    `- **原因**：${call.why}`,
  ]

  const nextSteps = findings.map((f) => f.advice).filter(Boolean)
  if (nextSteps.length) {
    out.push('- **下一步**：')
    out.push(...[...new Set(nextSteps)].map((a) => `  - ${a}`))
  }

  // ---- 基本信息 ----------------------------------------------------------
  out.push(
    '',
    '## 基本信息',
    `- 法定名称：${entity.legalName ?? '—'}`,
    `- 注册地：${countryName(entity.country)}${entity.city ? ` · ${entity.city}` : ''}${entity.street ? ` · ${entity.street}` : ''}`,
    `- 本国登记号：${entity.registeredAs ?? '未提供'}`,
    `- 登记机关：${authorityLabel}`,
    `- 全球识别码：${entity.lei}`,
  )

  // ---- 集团关系 ----------------------------------------------------------
  out.push('', '## 集团关系')
  if (directParent) {
    out.push(`- 直接母公司：${directParent.legalName}（${countryName(directParent.country)}，识别码 ${directParent.lei}）`)
  } else {
    out.push('- 直接母公司：登记库未记录。注意这不等于"没有母公司"——只有母公司自身也持有识别码时才会登记。')
  }
  if (ultimateParent && ultimateParent.lei !== directParent?.lei) {
    out.push(`- 最终母公司：${ultimateParent.legalName}（${countryName(ultimateParent.country)}）`)
  }
  if (typeof childCount === 'number') {
    out.push(`- 直接子公司：登记库记录 ${childCount} 家`)
  }

  // ---- 风险提示 ----------------------------------------------------------
  out.push('', `## 风险提示（${findings.length} 条）`)
  if (findings.length === 0) {
    out.push('未触发任何风险规则。')
  } else {
    for (const f of findings) {
      out.push(`- ${ICON[f.level]} **${f.label}** — ${f.finding}`)
    }
  }

  // ---- 数据体检表 --------------------------------------------------------
  const rows = [
    { field: '法定名称', value: entity.legalName ?? '—', asOf, source: 'GLEIF', mark },
    { field: '本国登记号', value: entity.registeredAs ?? '未提供', asOf, source: 'GLEIF', mark },
    { field: '登记机关', value: authorityLabel, asOf: '静态表', source: 'GLEIF 登记机关目录', mark: '✅' },
    { field: '注册地址', value: [entity.street, entity.city, countryName(entity.country)].filter(Boolean).join(', ') || '—', asOf, source: 'GLEIF', mark },
    { field: '主体状态', value: entity.entityStatus ?? '—', asOf, source: 'GLEIF', mark },
    // The record's own status is stated as of the same snapshot; the renewal
    // deadline is a separate, forward-looking date and gets its own row so the
    // "as of" column never shows a future date.
    { field: '登记记录状态', value: entity.recordStatus ?? '—', asOf, source: 'GLEIF', mark: '✅' },
    {
      field: '续期到期日',
      value: dateOnly(entity.nextRenewal),
      asOf: '—',
      source: 'GLEIF',
      mark: facts.renewalOverdueYears !== null ? '⚠️' : '✅',
    },
  ]
  if (directParent) {
    rows.push({ field: '直接母公司', value: `${directParent.legalName}（${countryName(directParent.country)}）`, asOf, source: 'GLEIF 关系数据', mark })
  }

  let mismatch = null
  if (vatResult) {
    const vatLabel = {
      valid: '有效',
      invalid: '无效',
      unavailable: '暂不可用',
      unsupported: '不适用',
      error: '校验失败',
    }[vatResult.status]
    rows.push({
      field: '增值税号',
      value: `${vatResult.country ?? ''}${vatResult.number ?? vat ?? ''} — ${vatLabel}`,
      asOf: dateOnly(vatResult.checkedAt) === '—' ? new Date().toISOString().slice(0, 10) : dateOnly(vatResult.checkedAt),
      source: '欧盟 VIES（成员国税务机关实时应答）',
      mark: vatResult.status === 'valid' ? '✅' : vatResult.status === 'invalid' ? '⛔' : '⚠️',
    })
    if (vatResult.name) {
      mismatch = crossCheckName(entity.legalName, vatResult.name)
      rows.push({
        field: '税务登记名称',
        value: vatResult.name,
        asOf: dateOnly(vatResult.checkedAt),
        source: '欧盟 VIES',
        mark: mismatch && !mismatch.agree ? '⛔' : '✅',
      })
    }
  }

  out.push('', '## 数据体检表', renderTable(rows))

  if (vatResult && !vatResult.name && vatResult.status === 'valid') {
    out.push(
      '',
      '> 该成员国仅返回增值税号有效性，不披露纳税人名称（返回 `---`）。',
      '> 因此无法做名称交叉核对——这是该国披露政策所致，不是核对失败。',
    )
  }
  if (mismatch && !mismatch.agree) {
    out.push(
      '',
      `> ⛔ **双源不一致**：登记名称为「${mismatch.registerName}」，税务登记名称为「${mismatch.viesName}」。`,
      '> 二者指向可能不是同一主体，须在推进前澄清。',
    )
  }

  // ---- 说明 --------------------------------------------------------------
  out.push(
    '',
    '## 说明',
    `- 风险规则：共 ${rulesMeta.count} 条，版本 ${rulesMeta.version}（${rulesMeta.updated}），可在插件的 rules/risk-rules.json 中查看与修改。`,
    '- 本档案为登记信息核对，不构成合规结论或法律意见；红黄提示用于提醒人工复核。',
    '- 未覆盖制裁与出口管制筛查。涉及受限国别、军民两用物项或大额授信时，须另行专项筛查。',
  )

  return out.join('\n')
}
