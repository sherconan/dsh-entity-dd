/**
 * EU VIES — the European Commission's VAT number validation service.
 *
 * Free, no key, and authoritative: it asks the member state's own tax
 * administration in real time. Useful precisely where GLEIF is weakest — small
 * and mid-sized EU businesses that never obtained an LEI still have a VAT
 * number, and this proves that number is currently registered and active.
 *
 * Known limitation, handled honestly below: several member states (Germany
 * among them) return validity ONLY and withhold the trader's name and address,
 * returning "---". A name that is withheld is not a name that failed to match.
 */

const BASE = 'https://ec.europa.eu/taxation_customs/vies/rest-api'
const TIMEOUT_MS = 20_000

/** VIES uses EL for Greece and XI for Northern Ireland, not the ISO codes. */
const EU_VAT_PREFIXES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI',
  'SK', 'XI',
])

/** Values a member state returns when it declines to disclose the field. */
const WITHHELD = new Set(['---', '', null, undefined])

/**
 * Split "DE811907980" (or "DE 811 907 980") into its country and number parts.
 * @returns {{country: string, number: string}|null}
 */
export function parseVatNumber(input, countryHint) {
  const raw = String(input ?? '').toUpperCase().replace(/[\s.\-/]/g, '')
  if (!raw) return null

  let country = raw.slice(0, 2)
  let number = raw.slice(2)
  if (!EU_VAT_PREFIXES.has(country)) {
    // No usable prefix on the number itself — fall back to the caller's hint.
    const hint = String(countryHint ?? '').toUpperCase().trim()
    const mapped = hint === 'GR' ? 'EL' : hint
    if (!EU_VAT_PREFIXES.has(mapped)) return null
    country = mapped
    number = raw
  }
  return number ? { country, number } : null
}

/**
 * Validate one EU VAT number.
 * @returns {Promise<{status:'valid'|'invalid'|'unavailable'|'unsupported'|'error',
 *                    country?:string, number?:string, name?:string|null,
 *                    address?:string|null, checkedAt?:string, detail?:string}>}
 */
export async function checkVat(input, countryHint) {
  const parsed = parseVatNumber(input, countryHint)
  if (!parsed) {
    return {
      status: 'unsupported',
      detail: '无法识别为欧盟增值税号。本校验仅覆盖欧盟成员国（含北爱尔兰），不适用于其他国家。',
    }
  }

  let response
  try {
    response = await fetch(`${BASE}/ms/${parsed.country}/vat/${encodeURIComponent(parsed.number)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'dsh-entity-dd' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    return {
      status: 'error',
      ...parsed,
      detail: `欧盟增值税校验服务不可达（${cause?.name ?? 'network error'}）。这是取数故障，不代表该号码无效。`,
    }
  }

  if (!response.ok) {
    return { status: 'error', ...parsed, detail: `校验服务返回 HTTP ${response.status}` }
  }

  let body
  try {
    body = await response.json()
  } catch {
    return { status: 'error', ...parsed, detail: '校验服务返回了无法解析的内容' }
  }

  // The member state's own system was unreachable — distinct from "invalid".
  if (body.userError && !['VALID', 'INVALID'].includes(body.userError)) {
    return {
      status: 'unavailable',
      ...parsed,
      detail: `成员国系统暂时不可用（${body.userError}）。请稍后重试，不要据此判定号码无效。`,
      checkedAt: body.requestDate ?? null,
    }
  }

  const clean = (v) => (WITHHELD.has(v) ? null : String(v).trim())
  return {
    status: body.isValid ? 'valid' : 'invalid',
    ...parsed,
    name: clean(body.name),
    address: clean(body.address),
    checkedAt: body.requestDate ?? null,
  }
}
