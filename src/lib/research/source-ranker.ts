/**
 * research/source-ranker.ts
 * Ranks and filters evidence sources by domain trustworthiness.
 * Returns quality-annotated source lists.
 */

import type { Source, SourceQuality } from "./types";

// ─── Domain quality tiers ─────────────────────────────────────────────────────
// Tier 1 (high): Primary sources — SEC filings, official company IR, major financial newswires
// Tier 2 (medium): Reputable financial press, major general press
// Tier 3 (low): Aggregators, blogs, forums, low-signal sources
// Unknown: anything not in the list

const HIGH_QUALITY_DOMAINS = new Set([
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "sec.gov",
  "ir.", // investor relations subdomains
  "businesswire.com",
  "prnewswire.com",
  "globenewswire.com",
  "apnews.com",
  "federalreserve.gov",
  "bls.gov",
  "bea.gov",
  "treasury.gov",
  "cnbc.com",
  "marketwatch.com",
  "barrons.com",
  "morningstar.com",
]);

const MEDIUM_QUALITY_DOMAINS = new Set([
  "finance.yahoo.com",
  "yahoo.com",
  "investing.com",
  "thestreet.com",
  "motleyfool.com",
  "fool.com",
  "seekingalpha.com",
  "benzinga.com",
  "zacks.com",
  "nasdaq.com",
  "pbs.org",
  "nytimes.com",
  "washingtonpost.com",
  "economist.com",
  "axios.com",
  "politico.com",
]);

const LOW_QUALITY_DOMAINS = new Set([
  "reddit.com",
  "twitter.com",
  "x.com",
  "stocktwits.com",
  "medium.com",
  "substack.com",
]);

// ─── Domain classification ────────────────────────────────────────────────────

function classifyDomain(url: string): { domain: string; quality: SourceQuality } {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");

    for (const d of HIGH_QUALITY_DOMAINS) {
      if (hostname.includes(d)) return { domain: hostname, quality: "high" };
    }
    for (const d of MEDIUM_QUALITY_DOMAINS) {
      if (hostname.includes(d)) return { domain: hostname, quality: "medium" };
    }
    for (const d of LOW_QUALITY_DOMAINS) {
      if (hostname.includes(d)) return { domain: hostname, quality: "low" };
    }
    return { domain: hostname, quality: "unknown" };
  } catch {
    return { domain: url, quality: "unknown" };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Annotate sources with quality metadata and sort highest-quality first.
 */
export function rankSources(sources: Source[]): Source[] {
  const qualityOrder: SourceQuality[] = ["high", "medium", "low", "unknown"];

  return sources
    .map((s) => {
      const { domain, quality } = classifyDomain(s.url);
      return { ...s, domain, quality };
    })
    .sort((a, b) => {
      const ai = qualityOrder.indexOf(a.quality ?? "unknown");
      const bi = qualityOrder.indexOf(b.quality ?? "unknown");
      return ai - bi;
    });
}

/**
 * Filter to only high + medium quality sources, removing noise.
 * Falls back to including all sources if too few remain after filtering.
 */
export function filterToTrustedSources(sources: Source[], minCount = 3): Source[] {
  const ranked = rankSources(sources);
  const trusted = ranked.filter(
    (s) => s.quality === "high" || s.quality === "medium"
  );
  // If we'd end up with fewer than minCount, keep everything so the LLM still has context
  return trusted.length >= minCount ? trusted : ranked;
}

/**
 * Summarize the quality composition of a source set.
 */
export function summarizeSourceQuality(sources: Source[]): {
  high: number;
  medium: number;
  low: number;
  unknown: number;
  overallQuality: SourceQuality;
} {
  const ranked = rankSources(sources);
  const counts = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const s of ranked) {
    counts[s.quality ?? "unknown"]++;
  }

  let overallQuality: SourceQuality = "unknown";
  if (counts.high >= 3) overallQuality = "high";
  else if (counts.high >= 1 || counts.medium >= 3) overallQuality = "medium";
  else if (counts.medium >= 1) overallQuality = "medium";
  else if (counts.low >= 1) overallQuality = "low";

  return { ...counts, overallQuality };
}

/**
 * Deduplicate sources by URL.
 */
export function deduplicateSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}
