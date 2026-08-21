export interface AttributionData {
  source: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  referrer_url: string | null
  landing_url: string | null
}

const STORAGE_KEY = "granite_attribution_data"

function resolveReferrerSource(referrer: string): string | null {
  if (!referrer) return null
  try {
    const url = new URL(referrer)
    const host = url.hostname.toLowerCase()

    if (host.includes("github.com")) return "github"
    if (host.includes("reddit.com")) return "reddit"
    if (host.includes("obsidian.md") || host.includes("forum.obsidian.md")) return "obsidian-forum"
    if (
      host.includes("lemmy") ||
      host.includes("kbin") ||
      host.includes("fediverse") ||
      host.includes("sh.itjust.works") ||
      host.includes("beehaw.org")
    ) {
      return "lemmy"
    }
    if (host.includes("news.ycombinator.com") || host.includes("ycombinator.com")) return "hackernews"
    if (host.includes("twitter.com") || host.includes("x.com")) return "twitter"
    if (host.includes("linkedin.com")) return "linkedin"

    // Ignore self-referrals
    if (typeof window !== "undefined" && host === window.location.hostname.toLowerCase()) {
      return null
    }

    return `ref:${host}`
  } catch {
    return null
  }
}

export function getAttributionData(): AttributionData {
  if (typeof window === "undefined") {
    return {
      source: "direct",
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      referrer_url: null,
      landing_url: null,
    }
  }

  // 1. Check if attribution is already cached in this session
  try {
    const cached = sessionStorage.getItem(STORAGE_KEY)
    if (cached) {
      const parsed = JSON.parse(cached) as AttributionData
      if (parsed && parsed.source) {
        return parsed
      }
    }
  } catch {
    // Ignore storage access issues (e.g. strict privacy modes)
  }

  // 2. Parse current URL query params
  const params = new URLSearchParams(window.location.search)
  const refParam = params.get("ref")?.trim()
  const utmSource = params.get("utm_source")?.trim() || null
  const utmMedium = params.get("utm_medium")?.trim() || null
  const utmCampaign = params.get("utm_campaign")?.trim() || null
  const utmContent = params.get("utm_content")?.trim() || null
  const sourceParam = params.get("source")?.trim()

  const referrerUrl = document.referrer ? document.referrer.slice(0, 500) : null
  const landingUrl = window.location.href ? window.location.href.slice(0, 500) : null

  // 3. Resolve primary source (Priority: ?ref= -> ?utm_source= -> ?source= -> document.referrer -> 'direct')
  let resolvedSource = "direct"

  if (refParam) {
    resolvedSource = refParam.toLowerCase()
  } else if (utmSource) {
    resolvedSource = utmSource.toLowerCase()
  } else if (sourceParam) {
    resolvedSource = sourceParam.toLowerCase()
  } else if (referrerUrl) {
    const inferred = resolveReferrerSource(referrerUrl)
    if (inferred) {
      resolvedSource = inferred
    }
  }

  const attribution: AttributionData = {
    source: resolvedSource,
    utm_source: utmSource || (refParam ? refParam.toLowerCase() : null),
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    utm_content: utmContent,
    referrer_url: referrerUrl,
    landing_url: landingUrl,
  }

  // 4. Save into sessionStorage for subsequent navigation / refreshes
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attribution))
  } catch {
    // Ignore storage failures
  }

  return attribution
}
