/**
 * Card presenters for the Web UI.
 *
 * These are pure functions of the call arguments and, for results, the tool's
 * own output. They run both during live streaming and when a saved session is
 * replayed, so they must never do I/O, read the clock, or throw — a malformed
 * or older log returns `undefined` and the generic card takes over.
 *
 * The one job here is to put the CONCLUSION in the card title. A due-diligence
 * card that says "entity_dossier" tells the reader nothing; one that says
 * "不可单独作为签约依据 · EBRO Armaturen" tells them what to do next without
 * opening anything.
 */

/** Pull the single text payload out of a tool result, if that is what it is. */
function resultText(result) {
  if (!result || result.isError) return null
  const only = Array.isArray(result.content) && result.content.length === 1 ? result.content[0] : null
  return only && only.type === 'text' && typeof only.text === 'string' ? only.text : null
}

const trim = (value, max) => {
  const text = String(value ?? '').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The verdict line the dossier writes, e.g. "- **能否采信**：不可作为签约依据". */
function readVerdict(text) {
  const match = /\*\*能否采信\*\*：\s*([^\n]+)/u.exec(text ?? '')
  return match ? match[1].trim() : null
}

/** The dossier's H1, e.g. "# 实体档案：EBRO Armaturen Gebr. Bröer GmbH". */
function readEntityName(text) {
  const match = /^#\s*实体档案：\s*([^\n]+)/mu.exec(text ?? '')
  return match ? match[1].trim() : null
}

/** How many risk findings the dossier reported. */
function readFindingCount(text) {
  const match = /##\s*风险提示（(\d+)\s*条）/u.exec(text ?? '')
  return match ? Number(match[1]) : null
}

/** Candidate count from a search result, e.g. "命中 4 个法人主体". */
function readCandidateCount(text) {
  const match = /命中\s*(\d+)\s*个法人主体/u.exec(text ?? '')
  return match ? Number(match[1]) : null
}

// ---- entity_search -------------------------------------------------------

export function presentSearchCall(args) {
  const name = trim(args?.name, 40)
  if (!name) return undefined
  return {
    card: 'generic',
    kind: 'search',
    title: `检索法人主体：${name}${args?.country ? `（${args.country}）` : ''}`,
  }
}

export function presentSearchResult(args, result) {
  const text = resultText(result)
  if (text === null) return undefined
  const name = trim(args?.name, 32)
  const count = readCandidateCount(text)

  if (count === null) {
    // The "not found" branch is a finding in its own right, not an empty result.
    const missing = /未在全球法人识别码库中找到/u.test(text)
    return {
      card: 'generic',
      kind: 'search',
      title: missing ? `未找到登记主体：${name}` : `检索完成：${name}`,
      content: missing ? '该主体未登记全球法人识别码。查不到本身不是风险信号，档案里给出了下一步。' : undefined,
    }
  }

  return {
    card: 'generic',
    kind: 'search',
    title: count > 1
      ? `⚠️ 一名多体：${name} 对应 ${count} 个独立法人`
      : `命中 1 个法人主体：${name}`,
    content: count > 1
      ? '这些是彼此独立的责任主体，与其中一家签约不能向另一家追责。请确认合同抬头是哪一个。'
      : undefined,
  }
}

// ---- entity_dossier ------------------------------------------------------

export function presentDossierCall(args) {
  const lei = trim(args?.lei, 24)
  if (!lei) return undefined
  return {
    card: 'generic',
    kind: 'fetch',
    title: `生成实体档案：${lei}${args?.vat ? ' + 增值税交叉验证' : ''}`,
  }
}

export function presentDossierResult(_args, result) {
  const text = resultText(result)
  if (text === null) return undefined
  const name = readEntityName(text)
  const verdict = readVerdict(text)
  if (!name || !verdict) return undefined

  const findings = readFindingCount(text)
  const blocked = verdict.startsWith('不可')
  return {
    card: 'generic',
    kind: 'fetch',
    title: `${blocked ? '⚠️' : '✅'} ${verdict} · ${trim(name, 34)}`,
    content: findings === null
      ? undefined
      : findings === 0
        ? '未触发风险规则。档案含基本信息、集团关系与数据体检表。'
        : `触发 ${findings} 条风险提示。档案含数据体检表，逐字段标注截至日期、来源与采信标记。`,
  }
}

// ---- entity_vat_check ----------------------------------------------------

export function presentVatCall(args) {
  const vat = trim(args?.vat, 24)
  if (!vat) return undefined
  return { card: 'generic', kind: 'fetch', title: `核验增值税号：${vat}` }
}

export function presentVatResult(args, result) {
  const text = resultText(result)
  if (text === null) return undefined
  const vat = trim(args?.vat, 24)
  if (/✅ 有效/u.test(text)) return { card: 'generic', kind: 'fetch', title: `✅ 增值税号有效：${vat}` }
  if (/⛔ 无效/u.test(text)) return { card: 'generic', kind: 'fetch', title: `⛔ 增值税号无效：${vat}` }
  return { card: 'generic', kind: 'fetch', title: `⚠️ 增值税号未能核验：${vat}` }
}
