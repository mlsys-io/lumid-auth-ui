/**
 * Shared TypeScript types mirroring the gateway response shapes.
 *
 * These mirror the `serde`-derived Rust structs in
 * `services/lqt-api-gateway/src/handlers/*.rs` and
 * `services/lqt-api-gateway/src/iceberg_reader.rs`.
 *
 * Naming: when a Rust struct has a `Wire` suffix (one row in a
 * collection), we drop it here and use the singular noun. When a
 * Rust struct has a `Body` suffix (the full response), we keep
 * `Body` so it's clear at the call-site this is the top-level
 * response shape.
 *
 * Stability: this file is the lumid_ui-side mirror of the gateway
 * wire JSON; the gateway is single-writer for the shapes. If you
 * touch a field name here, you also need to touch the matching Rust
 * struct (and re-run integration tests on the LQT side).
 */

// ============================================================
// /api/me — echoed claims for the current bearer.
// ============================================================
export interface MeBody {
  tenant_id: string;
  role: 'user' | 'admin' | 'super_admin' | string;
  email: string;
  scope: string;
  expires_at: number; // unix-millis
  source: 'jwks' | 'pat' | 'dev_fixture' | string;
}

// ============================================================
// Auditor.
// ============================================================
export interface AuditRow {
  seq: number;
  tenant_id: string;
  ts_ns: number;
  actor: string;
  kind: string;
  payload_hash_hex: string;
  entry_hash_hex: string;
}

export interface AuditHeadBody {
  rows: AuditRow[];
  next_seq: number | null;
}

export interface ChainHeadsSummary {
  tenant_count: number;
  head_hash_sample: string | null;
}

export interface AuditAnchor {
  anchor_seq: number;
  anchor_id: string;
  body_hash_hex: string;
  anchored_at_ns: number;
  chain_heads_summary: ChainHeadsSummary;
}

export interface AnchorsBody {
  anchors: AuditAnchor[];
}

export interface KindEntry {
  slot: number;
  name: string;
  kind_str: string;
}

export interface KindsBody {
  kinds: KindEntry[];
}

/** One frame from the `/api/audit/tail` SSE stream. */
export interface AuditTailRow {
  seq: number;
  tenant_id: string;
  ts_ns: number;
  actor: string;
  kind: string;
  payload_hash_hex: string;
  entry_hash_hex: string;
}

// ============================================================
// Trader.
// ============================================================
export interface Position {
  instrument_id: string;
  position_lots: number;
  avg_entry_price_ticks: number | null;
  cum_buys_lots: number;
  cum_sells_lots: number;
  last_updated_at_ns: number;
}

export interface PositionsBody {
  positions: Position[];
}

export interface Fill {
  fill_id: string;
  instrument_id: string;
  price_ticks: number;
  qty_lots: number;
  side: string;
  executed_at_ns: number;
  intent_id: string;
  oms_state_at_fill: string | null;
}

export interface FillsBody {
  fills: Fill[];
}

export interface EquivalencePnlClass {
  class_id: string;
  realized_pnl_lots: number;
  unrealized_pnl_lots: number;
  pending_range_lots: number;
  member_count: number;
  /** active | pending | settled | resolved */
  resolution_status: string;
}

export interface EquivalencePnlBody {
  classes: EquivalencePnlClass[];
}

export interface CrossVenueLeg {
  class_id: string;
  position_lots: number;
  unrealized_pnl_lots: number;
}

/**
 * One cross-venue aggregation. `null` legs preserve the "leg absent"
 * vs "leg zero" distinction from `lqt_portfolio::CrossVenueLeg`.
 */
export interface CrossVenueAggregation {
  xv_class_id: string;
  polymarket_leg: CrossVenueLeg | null;
  kalshi_leg: CrossVenueLeg | null;
  combined_position_lots: number;
  combined_pnl_lots: number;
}

export interface CrossVenueBody {
  aggregations: CrossVenueAggregation[];
}

export interface RiskDecision {
  seq: number;
  ts_ns: number;
  intent_id: string;
  /** allow | reject | unknown */
  decision: string;
  reject_reason: string | null;
  latency_us: number | null;
}

export interface RiskDecisionsBody {
  decisions: RiskDecision[];
}

export interface OmsOpenOrder {
  intent_id: string;
  instrument_id: string;
  side: string;
  qty_lots_total: number;
  qty_lots_filled: number;
  current_state: string;
  venue: string | null;
  venue_order_id: string | null;
  submitted_at_ns: number;
}

export interface OmsOpenOrdersBody {
  orders: OmsOpenOrder[];
}

/** One frame from `/api/md/bbo?instrument=…` SSE. */
export interface BboTick {
  instrument_id: string;
  ts_event_ns: number;
  bid_price_ticks: number | null;
  bid_size_lots: number | null;
  ask_price_ticks: number | null;
  ask_size_lots: number | null;
}

// ============================================================
// Researcher.
// ============================================================
export interface BacktestRun {
  run_id: string;
  signal_name: string;
  signal_version: string;
  sharpe: number | null;
  ir: number | null;
  hit_rate: number | null;
  ic: number | null;
  outcome: string;
  started_at_ns: number;
  completed_at_ns: number;
  fixture_hash: string;
  seed_hex: string;
}

export interface BacktestsBody {
  backtests: BacktestRun[];
}

export interface SignalIcPoint {
  /** ISO-8601 YYYY-MM-DD. */
  day: string;
  signal_name: string;
  signal_version: string;
  mean_ic: number;
  p_value: number;
  regime_context: string;
}

export interface SignalIcBody {
  points: SignalIcPoint[];
}

export interface RegimeBody {
  vol_bucket: string | null;
  spread_bucket: string | null;
  oi_bucket: string | null;
  computed_at_ns: number | null;
}

export interface BanditWeight {
  regime_context: string;
  alpha_id: string;
  posterior_alpha: number;
  posterior_beta: number;
  observation_count: number;
  last_updated_at_ns: number;
}

export interface BanditWeightsBody {
  cells: BanditWeight[];
}

export interface Promotion {
  seq: number;
  ts_ns: number;
  signal_name: string;
  signal_version: string;
  from_stage: string;
  to_stage: string;
  pr_branch: string | null;
  audit_kind_reserved: string | null;
}

export interface PromotionsBody {
  promotions: Promotion[];
}

export interface SignalRegistryEntry {
  name: string;
  version: string;
  owner: string;
  tenant_scope: string;
  module_path: string;
}

export interface SignalsBody {
  signals: SignalRegistryEntry[];
}

// ============================================================
// Operator.
// ============================================================
export type ServiceHealth = 'ok' | 'degraded' | 'down' | 'unknown';

export interface ServiceStatus {
  name: string;
  healthy: ServiceHealth;
  container_status: string;
  last_audit_emit_at_ns: number | null;
  uptime_secs: number | null;
}

export interface ServiceStatusBody {
  services: ServiceStatus[];
  docker_reachable: boolean;
}

export interface VenueDriftCounts {
  only_in_oms: number;
  only_in_venue: number;
  mismatched_state: number;
  throttled: number;
}

export interface DriftObserversByVenue {
  polymarket: VenueDriftCounts;
  kalshi: VenueDriftCounts;
}

export interface DriftObserversBody {
  by_venue: DriftObserversByVenue;
  window_secs: number;
}

export interface XpioLoop {
  name: string;
  schedule: string;
  kind: string;
  last_cycle_at_ns: number | null;
  last_outcome: string | null;
  next_tick_at_ns: number;
}

export interface XpioLoopsBody {
  loops: XpioLoop[];
}

export interface AlertState {
  name: string;
  severity: string;
  started_at_ns: number;
  summary: string;
}

export interface AlertsBody {
  alerts: AlertState[];
  /** False when Alertmanager is unreachable; `alerts` is then empty. */
  reachable: boolean;
}

export type PreflightStatus = 'ok' | 'warn' | 'fail';
export type PreflightOverall = 'ok' | 'degraded' | 'failing';

export interface PreflightCheck {
  name: string;
  status: PreflightStatus;
  detail: string;
}

export interface PreflightBody {
  checks: PreflightCheck[];
  overall: PreflightOverall;
}

/** One frame from `/api/ops/replicator-lag` SSE. */
export interface ReplicatorLagTick {
  /** Audit chain head sequence. */
  head_seq: number;
  /** Replicated tail sequence (audit.iceberg_replicated). */
  tail_seq: number;
  lag_rows: number;
  /** Computed as (head_ts_ns − tail_ts_ns) / 1e9 when both are present. */
  lag_seconds: number | null;
}

// ============================================================
// Accountant.
// ============================================================
export interface TreasuryEntry {
  entry_uuid: string;
  ts_ns: number;
  rail: string;
  amount_micros: number;
  currency: string;
  entry_type: string;
  source_audit_seq: number;
}

export interface TreasuryLedgerBody {
  entries: TreasuryEntry[];
}

export interface TreasuryBalance {
  rail: string;
  currency: string;
  balance_micros: number;
  last_movement_at_ns: number | null;
}

export interface TreasuryBalancesBody {
  balances: TreasuryBalance[];
}

export interface Tearsheet {
  day: string;
  strategy_id: string;
  sharpe: number | null;
  sortino: number | null;
  max_drawdown_lots: number | null;
  win_rate: number | null;
  status: string;
}

export interface TearsheetsBody {
  tearsheets: Tearsheet[];
}

export interface TcaRow {
  equivalence_class_id: string;
  venue: string | null;
  realized_pnl_lots: number;
  spread_cost_lots: number;
  tick_impact_lots: number;
  time_impact_lots: number;
  adverse_selection_lots: number;
  fee_lots: number;
}

export interface TcaBody {
  rows: TcaRow[];
  day: string;
}

export interface RegulatoryExport {
  seq: number;
  ts_ns: number;
  kind: string;
  workflow_name: string | null;
  lumilake_job_id: string | null;
  day_covered: string | null;
}

export interface ExportsBody {
  exports: RegulatoryExport[];
}

export interface CrossVenueComplianceRow {
  class_id: string;
  polymarket_notional_micros: number;
  kalshi_notional_micros: number;
  combined_notional_micros: number;
  resolution_aligned: boolean | null;
  divergence_kind: string | null;
}

export interface CrossVenueComplianceBody {
  rows: CrossVenueComplianceRow[];
  day: string;
}

// ============================================================
// Admin.
// ============================================================
export interface Tenant {
  tenant_id: string;
  email: string;
  role: string;
}

export interface TenantsBody {
  tenants: Tenant[];
  degraded: boolean;
}

export interface TenantAuditHeadBody {
  tenant_id: string;
  head_seq: number;
  head_hash_hex: string;
  anchored_at_ns: number;
}

export interface KillSwitchScope {
  scope: string;
  state: string;
  set_by: string;
  set_at_ns: number;
}

export interface TenantKillSwitchBody {
  tenant_id: string;
  scopes: KillSwitchScope[];
}

export interface HsmKey {
  key_id: string;
  label: string;
  last_rotated_at_ns: number;
  status: string;
}

export interface TenantHsmKeys {
  tenant_id: string;
  keys: HsmKey[];
}

export interface HsmKeysBody {
  tenants: TenantHsmKeys[];
}

// ============================================================
// Convenience union for the kill-switch indicator.
// ============================================================
export type KillSwitchSummary = 'ACTIVE' | 'PARTIAL' | 'DISABLED' | 'UNKNOWN';

// ============================================================
// Phase 6 (T-ANALYSIS-SLO) — operator SLO + fleet + analysis views.
// Mirror the wire structs in
// `services/lqt-api-gateway/src/handlers/operator.rs`.
// ============================================================

/** One (region, strategy) SLO group from `/api/ops/slo`. */
export interface SloGroup {
  region_id: string;
  strategy_id: string;
  cycles: number;
  cycle_p50_ns: number;
  cycle_p99_ns: number;
  decision_p99_ns: number;
  gate_p99_ns: number;
  router_p99_ns: number;
  n_proposed: number;
  n_submitted: number;
  n_rejected: number;
  n_suppressed: number;
}

export interface RejectReason {
  reason: string;
  count: number;
}

export interface SloBody {
  groups: SloGroup[];
  reject_reasons: RejectReason[];
  window_minutes: number;
  obs_reachable: boolean;
}

/** One region's fleet-liveness row from `/api/ops/fleet`. */
export interface FleetRegion {
  region_id: string;
  box_count: number;
  active_strategies: number;
  cycles: number;
  last_cycle_at_ns: number;
  ingest_lag_seconds: number;
}

export interface FleetBody {
  regions: FleetRegion[];
  window_minutes: number;
  obs_reachable: boolean;
}

/** One `analysis.pnl_reconciliation` row from `/api/ops/pnl-reconciliation`. */
export interface PnlReconRow {
  strategy_id: string;
  venue: string;
  day: string;
  realized_pnl_micros: number;
  expected_pnl_micros: number;
  pnl_divergence_micros: number;
  settled_positions: number;
  unreconciled_positions: number;
  mismark_positions: number;
  mismark_threshold_bps: number;
  fills_count: number;
}

export interface PnlReconBody {
  rows: PnlReconRow[];
  days: number;
}

/** One `analysis.fill_quality` row from `/api/ops/fill-quality`. */
export interface FillQualityRow {
  strategy_id: string;
  venue: string;
  day: string;
  markout_1s_bps: number;
  markout_10s_bps: number;
  markout_60s_bps: number;
  markout_300s_bps: number;
  markout_net_1s_bps: number;
  markout_net_10s_bps: number;
  markout_net_60s_bps: number;
  markout_net_300s_bps: number;
  toxic_fill_pct: number;
  net_toxic_fill_pct: number;
  toxic_base_n: number;
  net_of_markout_usd: number;
  fills_scored: number;
}

export interface FillQualityBody {
  rows: FillQualityRow[];
  days: number;
}
