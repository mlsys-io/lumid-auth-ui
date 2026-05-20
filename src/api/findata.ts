// Typed client for the lum.id /findata-cloud/* proxy → kv.run:5000.
// Auto-fetches a short-lived session-bearer JWT and caches it client-side.

const BASE = "/findata-cloud";

// ── Auth ─────────────────────────────────────────────────────────────────────

let _bearer: { token: string; expiresAt: number } | null = null;

async function getBearer(): Promise<string> {
  // Refresh 60s before expiry; assume 10min TTL per IssueBridgeJWT.
  if (_bearer && _bearer.expiresAt - 60_000 > Date.now()) {
    return _bearer.token;
  }
  const r = await fetch("/api/v1/session-bearer");
  if (!r.ok) throw new Error(`session-bearer ${r.status}`);
  const j = await r.json();
  const tok: string = j.data?.token ?? j.token ?? "";
  if (!tok) throw new Error("session-bearer returned empty token");
  _bearer = { token: tok, expiresAt: Date.now() + 9 * 60_000 };
  return tok;
}

async function call<T>(path: string): Promise<T> {
  const token = await getBearer();
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

// ── Types (loose — kv.run is single-source-of-truth) ────────────────────────

export interface Bar {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface OhlcResponse { symbol: string; interval: string; count: number; bars: Bar[]; }

export interface SymbolProfile {
  symbol: string;
  name: string | null;
  exchange: string | null;
  country: string | null;
  sector: string | null;
  industry: string | null;
  ipo_date: string | null;
  market_cap: number | null;
  is_etf: boolean;
  is_fund: boolean;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  sector?: string | null;
  industry?: string | null;
}

export interface Fundamentals { [key: string]: unknown; }

export interface FundamentalsHistRow {
  period_end_date: string;
  period_type: string;
  revenue?: number;
  gross_profit?: number;
  operating_income?: number;
  ebitda?: number;
  net_income?: number;
  eps?: number;
  [key: string]: unknown;
}

export interface NewsItem {
  ts?: string;
  published_at?: string;
  headline: string;
  summary?: string;
  url: string;
  source?: string;
  category?: string;
  [key: string]: unknown;
}

export interface Holder {
  institution_name?: string;
  shares?: number;
  market_value?: number;
  [key: string]: unknown;
}
export interface HoldersResponse { symbol: string; as_of?: string; count: number; holders: Holder[]; }

export interface PriceTarget {
  symbol: string;
  target_consensus: number | null;
  target_high: number | null;
  target_low: number | null;
  target_median: number | null;
  analysts: number | null;
  updated_at: string | null;
}

export interface Freshness {
  green: number;
  amber: number;
  red: number;
  gray: number;
  realtime?: {
    ws_subscribed?: number;
    polled?: number;
    ws_lag_p50_ms?: number;
    ws_lag_p99_ms?: number;
  };
}

// New types — v32 endpoint expansion (2026-05-20)

export interface Earning {
  symbol: string;
  report_date: string;
  fiscal_date: string | null;
  time_of_day: string | null;
  eps_estimated: number | null;
  eps_actual: number | null;
  revenue_estimated: number | null;
  revenue_actual: number | null;
}

export interface Filing {
  accession_no: string;
  form: string;
  filed_date: string;
  accepted_date: string;
  report_url: string;
  filing_url: string;
}

export interface TranscriptRef {
  symbol: string;
  fiscal_year: number;
  quarter: number;
  call_date: string;
  transcript_excerpt: string;
}

export interface TranscriptDetail extends TranscriptRef {
  transcript?: string;
  body?: string;
  [key: string]: unknown;
}

export interface Dividend {
  date: string;
  record_date: string | null;
  payment_date: string | null;
  declaration_date: string | null;
  amount: number;
  adj_amount: number;
  yield_pct: number;
  frequency: string;
}

export interface RecommendationRow {
  period: string;
  strong_buy: number;
  buy: number;
  hold: number;
  sell: number;
  strong_sell: number;
}

export interface Grade {
  date: string;
  firm: string;
  grade: string;
  action: string;
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export const findata = {
  freshness: () => call<Freshness>("/freshness"),
  searchSymbols: (q: string, limit = 8) =>
    call<SymbolSearchResult[]>(`/symbols/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  symbol: (sym: string) => call<SymbolProfile>(`/symbols/${encodeURIComponent(sym)}`),
  universe: (limit = 500) => call<{ symbol: string }[]>(`/universe?limit=${limit}`),
  ohlc: (sym: string, start: string, end: string, interval = "1d") =>
    call<OhlcResponse>(
      `/ohlc/${encodeURIComponent(sym)}?interval=${interval}&start=${start}&end=${end}`,
    ),
  fundamentals: (sym: string) =>
    call<Fundamentals>(`/fundamentals/${encodeURIComponent(sym)}/latest`),
  fundamentalsHistory: (sym: string, statement = "income", period = "quarter", limit = 8) =>
    call<FundamentalsHistRow[]>(
      `/fundamentals/${encodeURIComponent(sym)}/history?statement=${statement}&period=${period}&limit=${limit}`,
    ),
  news: (sym: string, limit = 20, since?: string) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (since) qs.set("since", since);
    return call<NewsItem[]>(`/news/${encodeURIComponent(sym)}?${qs}`);
  },
  holders: (sym: string, limit = 25) =>
    call<HoldersResponse>(`/holders/${encodeURIComponent(sym)}/top?limit=${limit}`),
  priceTarget: (sym: string) =>
    call<PriceTarget>(`/estimates/${encodeURIComponent(sym)}/price-target`),

  // v32 expansion — earnings/filings/transcripts/dividends + analyst signals
  earnings: (symbol?: string, limit = 50) =>
    call<Earning[]>(
      `/earnings?limit=${limit}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ""}`,
    ),
  filings: (sym: string, limit = 50) =>
    call<Filing[]>(`/filings/${encodeURIComponent(sym)}?limit=${limit}`),
  transcripts: (sym: string, limit = 12) =>
    call<TranscriptRef[]>(`/transcripts/${encodeURIComponent(sym)}?limit=${limit}`),
  transcript: (sym: string, year: number, quarter: number) =>
    call<TranscriptDetail>(
      `/transcripts/${encodeURIComponent(sym)}/${year}/${quarter}`,
    ),
  dividends: (sym: string, limit = 40) =>
    call<Dividend[]>(`/dividends/${encodeURIComponent(sym)}?limit=${limit}`),
  recommendation: (sym: string) =>
    call<RecommendationRow[]>(`/recommendation/${encodeURIComponent(sym)}`),
  grades: (sym: string, limit = 30) =>
    call<Grade[]>(`/grades/${encodeURIComponent(sym)}?limit=${limit}`),

  analystEstimates: (sym: string) =>
    call<unknown>(`/analyst-estimates/${encodeURIComponent(sym)}`),
  keyMetrics: (sym: string) =>
    call<KeyMetricsRow[]>(`/key-metrics/${encodeURIComponent(sym)}`),
  ratios: (sym: string) =>
    call<RatiosRow[]>(`/ratios/${encodeURIComponent(sym)}`),
  financialGrowth: (sym: string) =>
    call<unknown[]>(`/financial-growth/${encodeURIComponent(sym)}`),
  marketCapHistory: (sym: string) =>
    call<{ date: string; market_cap: number }[]>(
      `/market-cap/${encodeURIComponent(sym)}/history`,
    ),
  splits: (sym: string, limit = 20) =>
    call<{ date: string; numerator?: number; denominator?: number; ratio?: number }[]>(
      `/splits/${encodeURIComponent(sym)}?limit=${limit}`,
    ),
  insiderTransactions: (sym: string, limit = 50) =>
    call<InsiderTx[]>(`/insider/${encodeURIComponent(sym)}/transactions?limit=${limit}`),
  insiderSentiment: (sym: string) =>
    call<{ date?: string; mspr?: number; change?: number; [k: string]: unknown }[]>(
      `/insider/${encodeURIComponent(sym)}/sentiment`,
    ),
  insiderStatistics: (sym: string) =>
    call<unknown>(`/insider/${encodeURIComponent(sym)}/statistics`),
  acquisitions: (sym: string) => call<unknown[]>(`/acquisitions/${encodeURIComponent(sym)}`),
  govTrades: (sym: string) => call<unknown[]>(`/gov-trades/${encodeURIComponent(sym)}`),
  fundOwnership: (sym: string) =>
    call<unknown[]>(`/fund-ownership/${encodeURIComponent(sym)}`),
  fundsDisclosure: (sym: string) =>
    call<unknown[]>(`/funds-disclosure/${encodeURIComponent(sym)}`),

  // SSE realtime quotes — returned as a path string for native EventSource use
  quoteStreamUrl: (symbols: string[]) =>
    `${BASE}/quotes/stream?symbols=${symbols.map((s) => encodeURIComponent(s)).join(",")}`,

  // v67 expansion (2026-05-20) — valuation / company / ETF / ESG / gov / macro
  dcf:              (sym: string) => call<unknown[]>(`/dcf/${encodeURIComponent(sym)}`),
  enterpriseValue:  (sym: string) => call<EvRow[]>(`/enterprise-value/${encodeURIComponent(sym)}`),
  financialScores:  (sym: string) => call<unknown[]>(`/financial-scores/${encodeURIComponent(sym)}`),
  earningsQuality:  (sym: string) => call<EarningsQualityRow[]>(`/earnings-quality/${encodeURIComponent(sym)}`),
  ownerEarnings:    (sym: string) => call<unknown[]>(`/owner-earnings/${encodeURIComponent(sym)}`),
  earningsHistory:  (sym: string, limit = 20) =>
    call<EarningsHistoryRow[]>(`/earnings/${encodeURIComponent(sym)}/history?limit=${limit}`),
  executives:       (sym: string) => call<Executive[]>(`/executives/${encodeURIComponent(sym)}`),
  employeeCount:    (sym: string) => call<{ as_of: string; employee_count: number }[]>(`/employee-count/${encodeURIComponent(sym)}`),
  sharesFloat:      (sym: string) => call<unknown[]>(`/shares-float/${encodeURIComponent(sym)}`),
  peers:            (sym: string) => call<string[]>(`/peers/${encodeURIComponent(sym)}`),
  supplyChain:      (sym: string) => call<SupplyChainItem[]>(`/supply-chain/${encodeURIComponent(sym)}`),
  governanceComp:   (sym: string) => call<GovernanceComp[]>(`/governance/${encodeURIComponent(sym)}/compensation`),
  esgRatings:       (sym: string) => call<unknown>(`/esg/${encodeURIComponent(sym)}/ratings`),
  esgHistorical:    (sym: string) => call<unknown[]>(`/esg/${encodeURIComponent(sym)}/historical`),
  esgDisclosures:   (sym: string) => call<unknown[]>(`/esg/${encodeURIComponent(sym)}/disclosures`),
  etfInfo:          (sym: string) => call<unknown>(`/etf/${encodeURIComponent(sym)}/info`),
  etfHoldings:      (sym: string) => call<EtfHoldings>(`/etf/${encodeURIComponent(sym)}/holdings`),
  etfSectorWeights: (sym: string) => call<unknown[]>(`/etf/${encodeURIComponent(sym)}/sector-weightings`),
  etfCountryWeights:(sym: string) => call<unknown[]>(`/etf/${encodeURIComponent(sym)}/country-weightings`),
  etfExposure:      (sym: string) => call<EtfExposure[]>(`/symbol/${encodeURIComponent(sym)}/etf-exposure`),
  exchangeHolidays: (ex: string)  => call<unknown[]>(`/exchange/${encodeURIComponent(ex)}/holidays`),
  symbolSentiment:  (sym: string) => call<SymbolSentiment[]>(`/news/symbol-sentiment/${encodeURIComponent(sym)}`),
  socialSentiment:  (sym: string, params: { since?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.since) qs.set("since", params.since);
    if (params.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return call<SocialSentimentRow[]>(`/news/social-sentiment/${encodeURIComponent(sym)}${q ? `?${q}` : ""}`);
  },
  lobbying:         (sym: string) => call<unknown[]>(`/lobbying/${encodeURIComponent(sym)}`),
  usaSpending:      (sym: string) => call<unknown[]>(`/usa-spending/${encodeURIComponent(sym)}`),
  patents:          (sym: string, limit = 20) =>
    call<Patent[]>(`/uspto-patents/${encodeURIComponent(sym)}?limit=${limit}`),
  visas:            (sym: string) => call<unknown[]>(`/visa-applications/${encodeURIComponent(sym)}`),
  macroTreasury:    (limit = 30) => call<unknown[]>(`/macro/treasury-rates?limit=${limit}`),
  macroIndicators:  () => call<unknown[]>(`/macro/economic-indicators`),
  macroCalendar:    (limit = 50) => call<unknown[]>(`/macro/economic-calendar?limit=${limit}`),
  cot:              (sym: string) => call<unknown[]>(`/macro/cot/${encodeURIComponent(sym)}`),
  fdaCalendar:      (limit = 50) => call<unknown[]>(`/fda-calendar?limit=${limit}`),
  ipos:             (limit = 50) => call<IpoRow[]>(`/ipos?limit=${limit}`),
  mergersGlobal:    (limit = 50) => call<unknown[]>(`/mergers-acquisitions?limit=${limit}`),
  symbolChanges:    (limit = 50) => call<unknown[]>(`/symbol-changes?limit=${limit}`),

  // KOL — curated Twitter allowlist + 11M-row archive (kv.run:5000 /kols/*)
  kolRoster: (includeInactive = false) =>
    call<Kol[]>(`/kols${includeInactive ? "?include_inactive=true" : ""}`),
  kolArchiveStats: () => call<KolArchiveStats>("/kols/archive/stats"),
  kolRecentTweets: (limit = 50) =>
    call<KolTweet[]>(`/kols/tweets?limit=${limit}`),
  kolTweetsBySymbol: (sym: string, limit = 50) =>
    call<KolTweet[]>(`/kols/tweets/by-symbol/${encodeURIComponent(sym)}?limit=${limit}`),
  kolSymbolHistory: (sym: string, params: { since?: string; until?: string; handle?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.since)  qs.set("since",  params.since);
    if (params.until)  qs.set("until",  params.until);
    if (params.handle) qs.set("handle", params.handle);
    qs.set("limit", String(params.limit ?? 100));
    return call<KolTweet[]>(`/kols/tweets/by-symbol/${encodeURIComponent(sym)}/history?${qs}`);
  },
  kolSearch: (q: string, params: { since?: string; until?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams({ q });
    if (params.since) qs.set("since", params.since);
    if (params.until) qs.set("until", params.until);
    qs.set("limit", String(params.limit ?? 50));
    return call<KolTweet[]>(`/kols/tweets/search?${qs}`);
  },
  kolHandleTweets: (handle: string, limit = 50) =>
    call<KolTweet[]>(`/kols/${encodeURIComponent(handle)}/tweets?limit=${limit}`),
  kolHandleHistory: (handle: string, params: { since?: string; until?: string; cashtag?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.since)   qs.set("since",   params.since);
    if (params.until)   qs.set("until",   params.until);
    if (params.cashtag) qs.set("cashtag", params.cashtag);
    qs.set("limit", String(params.limit ?? 100));
    return call<KolTweet[]>(`/kols/${encodeURIComponent(handle)}/tweets/history?${qs}`);
  },
  kolStreamUrl: (symbols: string[]) =>
    `${BASE}/kols/tweets/stream${symbols.length ? `?symbols=${symbols.map(encodeURIComponent).join(",")}` : ""}`,
};

// v67 types

export interface EvRow {
  period_end_date: string;
  period_type: string;
  enterprise_value: number;
  market_cap: number;
  total_debt: number;
  cash_and_short_term: number;
}

export interface EarningsQualityRow {
  period_end_date: string;
  period_type: string;
  letter_score: string;
  score: number;
  growth: number;
  leverage: number;
  profitability: number;
  cash_generation: number;
}

export interface EarningsHistoryRow {
  fiscal_date: string;
  report_date: string;
  time_of_day: string | null;
  actual_eps: number | null;
  estimated_eps: number | null;
  surprise: number | null;
  surprise_pct: number | null;
  actual_revenue: number | null;
  estimated_revenue: number | null;
}

export interface Executive {
  name: string;
  title: string;
  since: string | null;
  until: string | null;
  age: number | null;
  gender: string | null;
  pay: number | null;
}

export interface SupplyChainItem {
  related_symbol: string;
  kind: "customer" | "supplier" | string;
  weight: number;
}

export interface GovernanceComp {
  name: string;
  year: number;
  compensation_total: number;
  compensation_breakdown: Record<string, number>;
}

export interface EtfHoldings {
  etf_symbol: string;
  as_of: string;
  count: number;
  holdings: {
    asset_symbol: string;
    asset_name: string;
    isin?: string;
    cusip?: string;
    shares_number?: number;
    weight_pct?: number;
    market_value?: number;
  }[];
}

export interface EtfExposure {
  etf_symbol: string;
  as_of: string | null;
  weight_pct: number;
  shares: number;
  market_value: number;
}

export interface SymbolSentiment {
  period_end_date: string;
  buzz: number;
  weekly_avg: number;
  articles_last_week: number;
  sentiment_score: number;
  bearish_pct: number;
  bullish_pct: number;
}

export interface Patent {
  filing_date: string;
  granted_date: string | null;
  patent_id: string;
  title: string;
}

export interface IpoRow {
  symbol: string;
  ipo_date: string;
  exchange: string;
  name: string;
  number_of_shares: number | null;
  price: number | null;
  total_shares_value: number | null;
  status: string;
}

export interface KeyMetricsRow {
  period_end_date: string;
  period_type: string;
  pe?: number | null;
  pb?: number | null;
  ps?: number | null;
  ev_ebitda?: number | null;
  ev_revenue?: number | null;
  debt_to_equity?: number | null;
  current_ratio?: number | null;
  quick_ratio?: number | null;
  roe?: number | null;
  roa?: number | null;
  fcf_yield?: number | null;
  [key: string]: unknown;
}

export interface RatiosRow {
  period_end_date: string;
  period_type: string;
  ratios: Record<string, number | null>;
}

export interface SocialSentimentRow {
  ts: string;
  mention: number | null;
  positive_score: number | null;
  negative_score: number | null;
  positive_mention: number | null;
  negative_mention: number | null;
}

export interface Kol {
  handle: string;
  display_name: string | null;
  twitter_id: string | null;
  follower_tier: string | null;
  notes: string | null;
  active: boolean;
  added_at: string | null;
  added_by: string | null;
  updated_at: string | null;
}

export interface KolArchiveStats {
  total_rows: number;
  distinct_kols: number;
  earliest: string | null;
  latest: string | null;
  last_ingest: string | null;
}

export interface KolTweet {
  tweet_id: string;
  created_at: string;
  kol_username: string;
  author_username: string;
  author_name: string | null;
  author_followers: number | null;
  author_verified: boolean | null;
  tweet_type: string | null;
  lang: string | null;
  text: string;
  url: string;
  cashtags: string[] | null;
  hashtags: string[] | null;
  mentioned_users: string[] | null;
  retweet_count: number | null;
  reply_count: number | null;
  like_count: number | null;
  quote_count: number | null;
  bookmark_count: number | null;
  view_count: number | null;
}

export interface InsiderTx {
  date: string;
  insider_name: string;
  insider_title: string | null;
  transaction_type: string;
  shares: number;
  price: number;
  value: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export function fmtNumber(n: number | null | undefined, opts: { decimals?: number; abbreviate?: boolean } = {}): string {
  if (n == null || !isFinite(n as number)) return "—";
  const { decimals = 2, abbreviate = false } = opts;
  if (abbreviate) {
    const abs = Math.abs(n);
    if (abs >= 1e12) return (n / 1e12).toFixed(decimals) + "T";
    if (abs >= 1e9) return (n / 1e9).toFixed(decimals) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(decimals) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(decimals) + "K";
  }
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

export function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null || !isFinite(n as number)) return "—";
  return (n * 100).toFixed(decimals) + "%";
}
