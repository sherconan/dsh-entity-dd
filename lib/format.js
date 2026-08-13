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
 */

const COUNTRY_ZH = {
  DE: '德国', US: '美国', CN: '中国', HK: '中国香港', TW: '中国台湾', JP: '日本',
  KR: '韩国', GB: '英国', FR: '法国', IT: '意大利', ES: '西班牙', NL: '荷兰',
  CH: '瑞士', SE: '瑞典', AT: '奥地利', BE: '比利时', PL: '波兰', SG: '新加坡',
  VN: '越南', TH: '泰国', MY: '马来西亚', ID: '印尼', IN: '印度', AE: '阿联酋',
  AU: '澳大利亚', CA: '加拿大', BR: '巴西', MX: '墨西哥', RU: '俄罗斯', TR: '土耳其',
  KY: '开曼群岛', VG: '英属维尔京群岛', BM: '百慕大', LU: '卢森堡', IE: '爱尔兰',
}

/** Jurisdictions that usually indicate a holding vehicle rather than an operating business. */
const OFFSHORE = new Set(['KY', 'VG', 'BM', 'PA', 'SC', 'BS', 'JE', 'GG', 'IM'])

const country = (code) => (code ? `${COUNTRY_ZH[code] ?? code}` : '未知')

/** Whole years between an ISO date and now; null when unparseable. */
function yearsSince(iso) {
  if (!iso) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  return (Date.now() - then) / (365.25 * 24 * 3600 * 1000)
}

/**
 * Decide whether a record may be relied on, and say why in one line.
 * Deliberately conservative: when in doubt, downgrade.
 */
export function assessFreshness(entity) {
  const age = yearsSince(entity.lastUpdate)
  const lapsed = ['LAPSED', 'RETIRED', 'ANNULLED', 'DUPLICATE'].includes(entity.recordStatus)
  const dead = ['INACTIVE', 'RETIRED', 'NULL'].includes(entity.entityStatus)

  if (dead) {
    return { level: 'red', label: '主体已失效', note: '登记显示该法人已注销或被合并，不可作为签约对手。' }
  }
  if (lapsed) {
    const span = age === null ? '较长时间' : `约 ${age.toFixed(1)} 年`
    return {
      level: 'amber',
      label: '档案陈旧',
      note: `主体仍存续，但其全球身份登记已失效（${entity.recordStatus}），记录${span}未更新；名称、地址、股东均可能已变更。`,
    }
  }
  if (age !== null && age > 1.5) {
    return {
      level: 'amber',
      label: '更新滞后',
      note: `记录已 ${age.toFixed(1)} 年未更新，关键字段可能过期。`,
    }
  }
  return { level: 'green', label: '记录在维护', note: '登记状态正常且近期有更新。' }
}

const ICON = { green: '✅', amber: '⚠️', red: '⛔' }

function renderOne(entity, index) {
  const fresh = assessFreshness(entity)
  const lines = [
    `${index}. ${entity.legalName ?? '(无名称)'}`,
    `   注册地    ${country(entity.country)}${entity.city ? ` · ${entity.city}` : ''}${entity.street ? ` · ${entity.street}` : ''}`,
    `   本国登记号 ${entity.registeredAs ?? '未提供'}${entity.registrationAuthority ? `（登记机关代码 ${entity.registrationAuthority}）` : ''}`,
    `   全球识别码 ${entity.lei}`,
    `   ${ICON[fresh.level]} ${fresh.label} — ${fresh.note}`,
  ]
  if (OFFSHORE.has(entity.country)) {
    lines.push('   ⚠️ 注册于离岸法域，通常为控股或贸易主体而非生产实体，需追溯实际控制人。')
  }
  return lines.join('\n')
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
      '  2. 若对方位于欧盟，可提供增值税号，本插件可做官方交叉验证；',
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
        (countries.length > 1 ? `，分布在 ${countries.map(country).join('、')}` : '') +
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
    '数据来源：全球法人识别码基金会（GLEIF）公开库，每日更新。',
    '本结果仅为登记信息核对，不构成合规结论或法律意见。',
  ].join('\n')
}
