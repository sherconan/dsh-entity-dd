/**
 * GLEIF (Global Legal Entity Identifier Foundation) access.
 *
 * GLEIF publishes the authoritative open register of legal entities that hold an
 * LEI. It is free, needs no API key, and carries each entity's NATIONAL business
 * register number — the field that lets a user cross-check against a local
 * register they may not be able to reach directly.
 *
 * Everything here is read-only and unauthenticated. This plugin stores and
 * transmits no credentials.
 */

const BASE = 'https://api.gleif.org/api/v1'
const TIMEOUT_MS = 20_000
const UA = 'dsh-entity-dd (https://github.com/sherconan/dsh-entity-dd)'

/** Sentinel for "the register answered, and the answer is 'no such relationship'". */
export const NOT_RECORDED = Symbol('not-recorded')

/**
 * One GLEIF request.
 * @returns parsed JSON, or NOT_RECORDED on 404.
 * @throws Error with a caller-readable message on any other failure.
 */
async function request(path) {
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { Accept: 'application/vnd.api+json', 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    // Network-level failure: offline, DNS, proxy interception, or timeout.
    throw new Error(`GLEIF 不可达（${cause?.name ?? 'network error'}）`, { cause })
  }
  // 404 is a real answer here: the relationship or record simply is not on file.
  if (response.status === 404) return NOT_RECORDED
  if (!response.ok) throw new Error(`GLEIF 返回 HTTP ${response.status}`)
  return response.json()
}

/**
 * Flatten one GLEIF lei-record into the fields this plugin reasons about.
 * Only scalar leaves are read; the raw record is never carried further.
 */
function toEntity(record) {
  const a = record.attributes ?? {}
  const entity = a.entity ?? {}
  const address = entity.legalAddress ?? {}
  const registration = a.registration ?? {}
  return {
    lei: a.lei ?? null,
    legalName: entity.legalName?.name ?? null,
    country: address.country ?? null,
    city: address.city ?? null,
    street: Array.isArray(address.addressLines) ? address.addressLines.join(', ') : null,
    postalCode: address.postalCode ?? null,
    // The national business-register number, e.g. "HRB 715" for a German GmbH.
    registeredAs: entity.registeredAs ?? null,
    registrationAuthorityCode: entity.registeredAt?.id ?? null,
    legalForm: entity.legalForm?.id ?? null,
    // Whether the entity itself is alive.
    entityStatus: entity.status ?? null,
    // Whether its LEI record is still being maintained — a separate question.
    recordStatus: registration.status ?? null,
    lastUpdate: registration.lastUpdateDate ?? null,
    nextRenewal: registration.nextRenewalDate ?? null,
    initialRegistration: registration.initialRegistrationDate ?? null,
  }
}

/**
 * Search candidate legal entities for a name.
 *
 * Two passes, because they fail differently:
 *   1. exact legalName filter — precise, but misses anything not spelled exactly;
 *   2. fuzzy completion — recovers the real spellings for the caller to retry.
 *
 * @returns {Promise<{candidates: object[], suggestions: string[], error: string|null}>}
 */
export async function searchEntities(name, country) {
  const query = String(name ?? '').trim()
  if (!query) return { candidates: [], suggestions: [], error: '名称为空' }

  const countryFilter = country
    ? `&filter[entity.legalAddress.country]=${encodeURIComponent(String(country).trim().toUpperCase())}`
    : ''

  let candidates = []
  let suggestions = []

  try {
    const exact = await request(
      `/lei-records?filter[entity.legalName]=${encodeURIComponent(query)}${countryFilter}&page[size]=10`,
    )
    candidates = exact === NOT_RECORDED ? [] : (exact.data ?? []).map(toEntity)
  } catch (error) {
    return { candidates: [], suggestions: [], error: error.message }
  }

  // Nothing matched the name as spelled: ask GLEIF what real names look like it.
  if (candidates.length === 0) {
    try {
      const fuzzy = await request(
        `/fuzzycompletions?field=entity.legalName&q=${encodeURIComponent(query)}`,
      )
      suggestions = fuzzy === NOT_RECORDED
        ? []
        : (fuzzy.data ?? [])
            .map((row) => row.attributes?.value)
            .filter((value) => typeof value === 'string')
            .slice(0, 8)
    } catch {
      // A failed suggestion pass is not fatal — the empty result still stands.
    }
  }

  return { candidates, suggestions, error: null }
}

/** Fetch one entity by its LEI. Returns null when no such record exists. */
export async function getEntity(lei) {
  const body = await request(`/lei-records/${encodeURIComponent(String(lei).trim())}`)
  if (body === NOT_RECORDED || !body?.data) return null
  return toEntity(body.data)
}

/**
 * Fetch a related entity.
 * @param kind 'direct-parent' | 'ultimate-parent'
 * @returns the related entity, or null when the register records no such relationship.
 */
export async function getRelatedEntity(lei, kind) {
  const body = await request(`/lei-records/${encodeURIComponent(lei)}/${kind}`)
  if (body === NOT_RECORDED || !body?.data) return null
  return toEntity(body.data)
}

/** How many direct subsidiaries the register lists. Returns null when unavailable. */
export async function countDirectChildren(lei) {
  const body = await request(`/lei-records/${encodeURIComponent(lei)}/direct-children?page[size]=1`)
  if (body === NOT_RECORDED) return 0
  return body?.meta?.pagination?.total ?? null
}

/**
 * Resolve a registration-authority code (e.g. RA000258) to the register's real
 * name, so the dossier shows "Handelsregister" rather than an opaque code.
 * Cached for the process lifetime; the authority list is effectively static.
 */
const authorityCache = new Map()
export async function getRegistrationAuthority(code) {
  if (!code) return null
  if (authorityCache.has(code)) return authorityCache.get(code)
  let result = null
  try {
    const body = await request(`/registration-authorities/${encodeURIComponent(code)}`)
    if (body !== NOT_RECORDED && body?.data) {
      const a = body.data.attributes ?? {}
      result = {
        code,
        internationalName: a.internationalName ?? null,
        localName: a.localName ?? null,
        country: a.country ?? null,
        website: a.website ?? null,
      }
    }
  } catch {
    // Cosmetic lookup only — never fail a dossier because the name is missing.
  }
  authorityCache.set(code, result)
  return result
}
