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
  kolMediaUrl: (twitterCdnUrl: string) =>
    `${BASE}/kols/media/by-url?u=${encodeURIComponent(twitterCdnUrl)}`,

  // News — cross-symbol surface (added by kv.run 2026-05-20)
  newsLatest: (params: { category?: string; since?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.category) qs.set("category", params.category);
    if (params.since)    qs.set("since",    params.since);
    qs.set("limit", String(params.limit ?? 50));
    return call<NewsArticleWithCategory[]>(`/news/latest?${qs}`);
  },
  newsSearch: (q: string, params: { category?: string; since?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams({ q });
    if (params.category) qs.set("category", params.category);
    if (params.since)    qs.set("since",    params.since);
    qs.set("limit", String(params.limit ?? 50));
    return call<NewsArticleWithCategory[]>(`/news/search?${qs}`);
  },
  newsStats: () => call<NewsCategoryStats>("/news/stats"),

  // Prediction markets (Polymarket + Kalshi, /prediction-markets/*)
  pmEvents: (params: { q?: string; status?: "open" | "closed" | "all"; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.status) qs.set("status", params.status);
    qs.set("limit", String(params.limit ?? 50));
    return call<PmEventRow[]>(`/prediction-markets/events?${qs}`);
  },
  pmSearch: (q: string, params: { venue?: "polymarket" | "kalshi"; status?: "open" | "closed" | "all"; limit?: number } = {}) => {
    const qs = new URLSearchParams({ q });
    if (params.venue) qs.set("venue", params.venue);
    if (params.status) qs.set("status", params.status);
    qs.set("limit", String(params.limit ?? 50));
    return call<PmMarketRow[]>(`/prediction-markets/markets/search?${qs}`);
  },
  pmLeaderboard: (params: { window?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.window) qs.set("window", params.window);
    qs.set("limit", String(params.limit ?? 50));
    return call<PmLeaderboardRow[]>(`/prediction-markets/leaderboard?${qs}`);
  },
  // SSE — EventSource opens this directly. /findata-cloud/ proxies to
  // kv.run:5000 unauthenticated (read-only feed).
  pmStreamUrl: (params: { assetIds?: string[]; conditionIds?: string[] } = {}) => {
    const qs = new URLSearchParams();
    if (params.assetIds?.length) qs.set("asset_ids", params.assetIds.join(","));
    if (params.conditionIds?.length) qs.set("condition_ids", params.conditionIds.join(","));
    return `${BASE}/prediction-markets/stream${qs.toString() ? `?${qs}` : ""}`;
  },

  // Market detail — Polymarket needs condition_id (0x…), Kalshi needs ticker.
  pmPolymarketDetail: (conditionId: string) =>
    call<PmPolymarketDetail>(`/prediction-markets/markets/polymarket/${encodeURIComponent(conditionId)}`),
  pmKalshiDetail: (ticker: string) =>
    call<PmKalshiDetail>(`/prediction-markets/markets/kalshi/${encodeURIComponent(ticker)}`),

  // OHLCV candle history (per market_id). interval is in seconds.
  pmCandles: (venue: "polymarket" | "kalshi", marketId: string, params: { interval?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    qs.set("interval", String(params.interval ?? 3600));
    qs.set("limit", String(params.limit ?? 200));
    return call<PmCandleRow[]>(`/prediction-markets/candles/${venue}/${encodeURIComponent(marketId)}?${qs}`);
  },

  // Orderbook snapshots. Polymarket is keyed by asset_id (CLOB token id,
  // one per outcome). Kalshi is keyed by ticker.
  pmOrderbookPolymarket: (assetId: string, limit = 5) =>
    call<PmOrderbookSnap[]>(`/prediction-markets/orderbook/polymarket/${encodeURIComponent(assetId)}?limit=${limit}`),
  pmOrderbookKalshi: (ticker: string, limit = 5) =>
    call<PmOrderbookSnap[]>(`/prediction-markets/orderbook/kalshi/${encodeURIComponent(ticker)}?limit=${limit}`),

  // Recent fills. For open Polymarket markets this is the most reliable
  // price source — clob_token_ids on the detail response is currently
  // null for newly-ingested open markets, so trades carry the only
  // CLOB asset reference (via row.token_id) plus the price/ts series.
  pmTradesPolymarket: (conditionId: string, limit = 200) =>
    call<PmTradeRow[]>(`/prediction-markets/trades/polymarket/${encodeURIComponent(conditionId)}?limit=${limit}`),
  pmTradesKalshi: (ticker: string, limit = 200) =>
    call<PmTradeRow[]>(`/prediction-markets/trades/kalshi/${encodeURIComponent(ticker)}?limit=${limit}`),

  // ── kv.run:5000 v0.1.0 upstream sync — 16 new families ─────────────
  // Added 2026-05-29. The upstream OpenAPI lists 133 endpoints across 72
  // families; this block covers the 16 families findata.ts was missing.
  // Tag families that surface in a UI dashboard page get richer types;
  // niche/raw families default to `unknown` so callers can opt in to
  // schema authoring without blocking the wire-up.

  // — Stock screener + market movers ————————————————————
  screener: (q: ScreenerQuery = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const s = qs.toString();
    return call<ScreenerRow[]>(`/screener${s ? "?" + s : ""}`);
  },
  marketMovers: (kind: "gainer" | "loser" | "most_active" = "gainer", limit = 50) =>
    call<MarketMoverRow[]>(`/market-movers?kind=${kind}&limit=${limit}`),

  // — Index constituents ————————————————————————————
  indexConstituents: (indexSymbol: string, asOf?: string) =>
    call<IndexConstituent[]>(
      `/index/${encodeURIComponent(indexSymbol)}/constituents${asOf ? "?as_of=" + encodeURIComponent(asOf) : ""}`,
    ),

  // — Sector / industry snapshots —————————————————————
  sectorsPE: (exchange?: string) =>
    call<SectorRow[]>(`/sectors/pe${exchange ? "?exchange=" + encodeURIComponent(exchange) : ""}`),
  sectorsPerformance: (exchange?: string) =>
    call<SectorRow[]>(`/sectors/performance${exchange ? "?exchange=" + encodeURIComponent(exchange) : ""}`),
  industriesPE: (exchange?: string) =>
    call<IndustryRow[]>(`/industries/pe${exchange ? "?exchange=" + encodeURIComponent(exchange) : ""}`),
  industriesPerformance: (exchange?: string) =>
    call<IndustryRow[]>(`/industries/performance${exchange ? "?exchange=" + encodeURIComponent(exchange) : ""}`),

  // — Calendars ————————————————————————————————————
  dividendsCalendar: (params: { from?: string; to?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.from)  qs.set("from", params.from);
    if (params.to)    qs.set("to", params.to);
    if (params.limit) qs.set("limit", String(params.limit));
    const s = qs.toString();
    return call<DividendCalendarRow[]>(`/dividends-calendar${s ? "?" + s : ""}`);
  },
  splitsCalendar: (params: { from?: string; to?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.from)  qs.set("from", params.from);
    if (params.to)    qs.set("to", params.to);
    if (params.limit) qs.set("limit", String(params.limit));
    const s = qs.toString();
    return call<SplitCalendarRow[]>(`/splits-calendar${s ? "?" + s : ""}`);
  },
  exchangeMarketHours: (exchange?: string) =>
    call<ExchangeHoursRow[]>(`/exchange-market-hours${exchange ? "?exchange=" + encodeURIComponent(exchange) : ""}`),

  // — Growth series (BS / CF / IS) ——————————————————————
  balanceSheetGrowth: (sym: string, period: "annual" | "quarter" = "annual", limit = 10) =>
    call<unknown[]>(
      `/balance-sheet-growth/${encodeURIComponent(sym)}?period=${period}&limit=${limit}`,
    ),
  cashFlowGrowth: (sym: string, period: "annual" | "quarter" = "annual", limit = 10) =>
    call<unknown[]>(
      `/cash-flow-growth/${encodeURIComponent(sym)}?period=${period}&limit=${limit}`,
    ),
  incomeStatementGrowth: (sym: string, period: "annual" | "quarter" = "annual", limit = 10) =>
    call<unknown[]>(
      `/income-statement-growth/${encodeURIComponent(sym)}?period=${period}&limit=${limit}`,
    ),

  // — Institutional 13-F (5 endpoints) —————————————————
  institutionalHoldersAnalytics: (
    sym: string,
    params: { year?: number; quarter?: number; limit?: number } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.year)    qs.set("year",    String(params.year));
    if (params.quarter) qs.set("quarter", String(params.quarter));
    if (params.limit)   qs.set("limit",   String(params.limit));
    const s = qs.toString();
    return call<unknown[]>(
      `/institutional/${encodeURIComponent(sym)}/holders/analytics${s ? "?" + s : ""}`,
    );
  },
  institutionalHolderPerformance: (cik: string, limit = 25) =>
    call<unknown[]>(`/institutional/holder/${encodeURIComponent(cik)}/performance?limit=${limit}`),
  institutionalHolderIndustries: (
    cik: string,
    params: { year?: number; quarter?: number; limit?: number } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.year)    qs.set("year",    String(params.year));
    if (params.quarter) qs.set("quarter", String(params.quarter));
    if (params.limit)   qs.set("limit",   String(params.limit));
    const s = qs.toString();
    return call<unknown[]>(
      `/institutional/holder/${encodeURIComponent(cik)}/industries${s ? "?" + s : ""}`,
    );
  },
  institutionalHolderDates: (cik: string, limit = 25) =>
    call<unknown[]>(`/institutional/holder/${encodeURIComponent(cik)}/dates?limit=${limit}`),
  institutionalIndustries: (year?: number, quarter?: number) => {
    const qs = new URLSearchParams();
    if (year)    qs.set("year",    String(year));
    if (quarter) qs.set("quarter", String(quarter));
    const s = qs.toString();
    return call<unknown[]>(`/institutional/industries${s ? "?" + s : ""}`);
  },

  // — Technical indicators ————————————————————————————
  technicalIndicators: (
    sym: string,
    params: { indicator?: string; start?: string; end?: string; limit?: number } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.indicator) qs.set("indicator", params.indicator);
    if (params.start)     qs.set("start", params.start);
    if (params.end)       qs.set("end", params.end);
    if (params.limit)     qs.set("limit", String(params.limit));
    const s = qs.toString();
    return call<unknown[]>(`/technical/${encodeURIComponent(sym)}${s ? "?" + s : ""}`);
  },
  technicalLatest: (sym: string) =>
    call<unknown>(`/technical/${encodeURIComponent(sym)}/latest`),

  // — Single-symbol metrics snapshot ——————————————————————
  metricsSnapshot: (sym: string) =>
    call<unknown>(`/metrics-snapshot/${encodeURIComponent(sym)}`),

  // — XBRL ————————————————————————————————————————
  xbrlFilings: (sym: string, limit = 25) =>
    call<unknown[]>(`/xbrl/${encodeURIComponent(sym)}/filings?limit=${limit}`),
  xbrlFiling: (sym: string, accession: string) =>
    call<unknown>(`/xbrl/${encodeURIComponent(sym)}/filing/${encodeURIComponent(accession)}`),

  // — Executive comp benchmark by industry ——————————————————
  execCompBenchmark: (industry: string) =>
    call<unknown>(`/exec-comp-benchmark/${encodeURIComponent(industry)}`),
};

// ── New typed responses for the 2026-05-29 upstream sync ────────────

export interface ScreenerQuery {
  sector?:         string;
  industry?:       string;
  country?:        string;
  exchange?:       string;
  is_etf?:         boolean;
  is_fund?:        boolean;
  market_cap_min?: number;
  market_cap_max?: number;
  symbol_prefix?:  string;
  limit?:          number;
  offset?:         number;
}

export interface ScreenerRow {
  symbol:        string;
  name?:         string | null;
  sector?:       string | null;
  industry?:     string | null;
  country?:      string | null;
  exchange?:     string | null;
  market_cap?:   number | null;
  is_etf?:       boolean | null;
  is_fund?:      boolean | null;
}

export interface MarketMoverRow {
  symbol:        string;
  name?:         string | null;
  price?:        number | null;
  change?:       number | null;
  change_pct?:   number | null;
  volume?:       number | null;
  kind?:         "gainer" | "loser" | "most_active" | string;
}

export interface IndexConstituent {
  symbol:        string;
  name?:         string | null;
  sector?:       string | null;
  weight?:       number | null;
  added_on?:     string | null;
  removed_on?:   string | null;
}

export interface SectorRow {
  sector?:       string | null;
  pe?:           number | null;
  return_1d?:    number | null;
  return_1w?:    number | null;
  exchange?:     string | null;
}

export interface IndustryRow {
  industry?:     string | null;
  sector?:       string | null;
  pe?:           number | null;
  return_1d?:    number | null;
  return_1w?:    number | null;
  exchange?:     string | null;
}

export interface DividendCalendarRow {
  symbol:        string;
  date:          string;
  amount?:       number | null;
  yield?:        number | null;
  record_date?:  string | null;
  pay_date?:     string | null;
}

export interface SplitCalendarRow {
  symbol:        string;
  date:          string;
  numerator?:    number | null;
  denominator?:  number | null;
}

export interface ExchangeHoursRow {
  exchange:      string;
  open?:         string | null;
  close?:        string | null;
  timezone?:     string | null;
  is_open?:      boolean | null;
}

export interface PmPolymarketDetail {
  condition_id: string;
  market_id: string;
  question: string;
  slug: string;
  outcomes: string[];
  outcome_prices: string[];
  clob_token_ids: string[];
  volume: number | null;
  liquidity: number | null;
  start_date: string | null;
  end_date: string | null;
  closed_time: string | null;
  active: boolean;
  closed: boolean;
  archived: boolean;
  enable_order_book: boolean;
}

export interface PmKalshiDetail {
  ticker: string;
  title?: string;
  question?: string;
  status?: string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  volume?: number;
  open_interest?: number;
  open_time?: string;
  close_time?: string;
  [k: string]: unknown;
}

// As returned by /prediction-markets/candles/{venue}/{market_id}.
// Note: the endpoint aggregates across YES and NO outcomes in the same
// response — `close` may reflect either side's trade price. Normalize
// to implied-YES via `close > 0.5 ? close : 1 - close` before plotting.
// `volume=0` with `trades=null` indicates an OB-midprice-derived bar
// (no trades in that bucket); `volume>0` is trade-derived.
export interface PmCandleRow {
  bucket_ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number | null;
}

export interface PmOrderbookLevel { price: string; size: string }
export interface PmOrderbookSnap {
  asset_id?: string;
  condition_id?: string | null;
  ticker?: string;
  snapshot_ts: string;
  bids: PmOrderbookLevel[];
  asks: PmOrderbookLevel[];
  tick_size?: string;
  min_order_size?: string;
}

export interface PmTradeRow {
  trade_id: string;
  ts: string;             // ISO
  price: number;
  side: "BUY" | "SELL" | string;
  size: number;
  token_id?: string;      // Polymarket CLOB token id (per outcome)
  taker?: string;
}

// ── Prediction-market types ────────────────────────────────────────────────

export interface PmEventRow {
  event_id: string;
  slug: string;
  title: string;
  category: string;
  total_volume: number | null;
  active: boolean | null;
  closed: boolean | null;
  start_date: string | null;
  end_date: string | null;
}

export interface PmMarketRow {
  venue: "polymarket" | "kalshi";
  market_id: string;
  title: string;
  slug: string | null;
  volume: number | null;
  start_date: string | null;
  end_date: string | null;
  closed: boolean | null;
}

export interface PmLeaderboardRow {
  rank: number;
  wallet: string;
  total_pnl: number;
  realized_pnl: number;
  volume: number;
  roi: number;
  trades: number;
  win_rate: number;
  primary_style: string;
  is_whale: boolean;
  first_trade_at: string;
}

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

// News — cross-symbol surface (kv.run /news/latest + /news/search + /news/stats)
export interface NewsArticleWithCategory {
  published_at: string;
  publisher: string | null;
  headline: string;
  summary: string | null;
  url: string;
  category: string | null;
  symbol: string | null;
}

export interface NewsCategoryStatRow {
  category: string | null;
  rows_last_7d: number;
  rows_last_30d: number;
  latest_in_60d: string | null;
}

export interface NewsCategoryStats {
  categories: NewsCategoryStatRow[];
  [key: string]: unknown;
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
  // Embedded media (added by kv.run 2026-05-20).
  // `media_urls` = original Twitter CDN URLs (pbs.twimg.com / video.twimg.com etc.).
  // `media_proxy_urls` = server-pre-resolved local-mirror paths, relative to kv.run
  // root (e.g. "/kols/media/by-url?u=..."). Prepend BASE to render directly.
  media_urls: string[] | null;
  media_proxy_urls: string[] | null;
  retweet_count: number | null;
  reply_count: number | null;
  like_count: number | null;
  quote_count: number | null;
  bookmark_count: number | null;
  view_count: number | null;
}

// Resolve a kv.run media URL (raw Twitter CDN or `/kols/media/by-url?u=…`
// proxy entry) to a same-origin URL the browser can load directly.
//
// Background: kv.run's `/kols/media/by-url` 302-redirects to a RELATIVE path
// `/kols/media/img/<bucket>/<file>` where `<bucket>` is the first 2 chars of
// the filename, lowercased (e.g. `HInXuVwWkAATtza.jpg` → bucket `hi`,
// `Ny4gfGWqUuUCU66U.jpg` → bucket `ny`). When the browser follows that 302
// from an <img> tag, the relative Location header resolves against the page
// origin (lum.id), not kv.run — so the redirect lands on the SPA shell and
// returns HTML, not the image. We sidestep the redirect by synthesizing the
// final cached-mirror URL ourselves.
//
// Video assets (video.twimg.com, .mp4 / .m3u8) are NOT cached by kv.run —
// it returns an absolute redirect to the original twimg.com URL. We let
// those pass through unchanged; callers should filter them out before
// rendering via <img>.
export function resolveMediaProxyUrl(input: string): string {
  if (!input) return "";
  // Already an absolute URL? Trust it (e.g. a non-Twitter source).
  if (input.startsWith("http://") || input.startsWith("https://")) {
    return _twitterToLocalMirror(input);
  }
  // `/kols/media/by-url?u=<encoded>` — decode the inner URL and recurse.
  if (input.includes("/kols/media/by-url")) {
    const qs = input.split("?")[1] ?? "";
    const u = new URLSearchParams(qs).get("u");
    if (u) return _twitterToLocalMirror(u);
  }
  // Already a relative kv.run path (e.g. `/kols/media/img/hi/X.jpg`) — proxy as-is.
  const path = input.startsWith("/") ? input : `/${input}`;
  return `/findata-cloud${path}`;
}

// Lowercased extensions kv.run does NOT mirror locally (video / stream).
const _VIDEO_EXT_RE = /\.(mp4|m3u8|webm|mov|m4v)(\?|$)/i;

export function isVideoMediaUrl(input: string): boolean {
  if (!input) return false;
  if (input.includes("video.twimg.com")) return true;
  return _VIDEO_EXT_RE.test(input);
}

function _twitterToLocalMirror(rawUrl: string): string {
  // Videos aren't mirrored — pass through (browser hits twimg.com directly,
  // but typically we filter these out of <img> rendering upstream).
  if (isVideoMediaUrl(rawUrl)) return rawUrl;
  // Match the LAST path segment as the filename (greedy `.+` so deep paths
  // like ext_tw_video_thumb/<id>/pu/img/<file> still resolve to `<file>`).
  const m = rawUrl.match(/twimg\.com\/.+\/([^/?#]+)/);
  if (m && m[1]) {
    const filename = m[1];
    const bucket = filename.slice(0, 2).toLowerCase();
    return `/findata-cloud/kols/media/img/${bucket}/${filename}`;
  }
  // Non-twitter raw URL — fall back to loading direct (works for images;
  // CORS doesn't restrict <img> tags). Future-proof for non-Twitter sources.
  return rawUrl;
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
