/**
 * GLEIF (Global Legal Entity Identifier Foundation) access.
 *
 * GLEIF publishes the authoritative open register of legal entities that hold an
 * LEI. It is free, needs no API key, and carries each entity's NATIONAL business
 * register number — which is the field that lets a user cross-check against the
 * local register without being able to reach that register directly.
 *
 * Everything here is read-only and unauthenticated. No credentials are stored or
 * transmitted by this plugin.
 */

const BASE = 'https://api.gleif.org/api/v1'
const TIMEOUT_MS = 20_000
const UA = 'dsh-entity-dd (https://github.com/sherconan/dsh-entity-dd)'

/**
 * One GLEIF request. Returns parsed JSON, or throws a caller-readable Error.
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
    throw new Error(`GLEIF unreachable (${cause?.name ?? 'network error'})`, { cause })
  }
  if (!response.ok) throw new Error(`GLEIF returned HTTP ${response.status}`)
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
    // The national business-register number, e.g. "HRB 715" for a German GmbH.
    registeredAs: entity.registeredAs ?? null,
    registrationAuthority: entity.registeredAt?.id ?? null,
    legalForm: entity.legalForm?.id ?? null,
    // Whether the entity itself is alive.
    entityStatus: entity.status ?? null,
    // Whether its LEI record is still being maintained — a separate question.
    recordStatus: registration.status ?? null,
    lastUpdate: registration.lastUpdateDate ?? null,
    nextRenewal: registration.nextRenewalDate ?? null,
  }
}

/**
 * Search candidate legal entities for a name.
 *
 * Two passes, because they fail differently:
 *   1. exact legalName filter — precise, but misses anything not spelled exactly;
 *   2. fuzzy completion — recovers the real spellings, which pass 1 is then run on.
 *
 * @returns {Promise<{candidates: object[], suggestions: string[], error: string|null}>}
 */
export async function searchEntities(name, country) {
  const query = String(name ?? '').trim()
  if (!query) return { candidates: [], suggestions: [], error: 'empty name' }

  const countryFilter = country
    ? `&filter[entity.legalAddress.country]=${encodeURIComponent(String(country).trim().toUpperCase())}`
    : ''

  let candidates = []
  let suggestions = []

  try {
    const exact = await request(
      `/lei-records?filter[entity.legalName]=${encodeURIComponent(query)}${countryFilter}&page[size]=10`,
    )
    candidates = (exact.data ?? []).map(toEntity)
  } catch (error) {
    return { candidates: [], suggestions: [], error: error.message }
  }

  // Nothing matched the name as spelled: ask GLEIF what real names look like it.
  if (candidates.length === 0) {
    try {
      const fuzzy = await request(
        `/fuzzycompletions?field=entity.legalName&q=${encodeURIComponent(query)}`,
      )
      suggestions = (fuzzy.data ?? [])
        .map((row) => row.attributes?.value)
        .filter((value) => typeof value === 'string')
        .slice(0, 8)
    } catch {
      // A failed suggestion pass is not fatal — the empty result still stands.
    }
  }

  return { candidates, suggestions, error: null }
}
