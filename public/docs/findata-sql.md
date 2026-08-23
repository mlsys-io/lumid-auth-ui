# FinData SQL Access

## Overview

The FinData warehouse (market data, fundamentals, prediction markets, news, macro, and more —
1.7&nbsp;TB, 22 schemas, ~9,800 tables) is reachable with **real SQL**, not only over HTTP. Point
`psql`, DBeaver, pgAdmin, Metabase, Tableau, or DuckDB's `postgres` extension straight at it.

Use this when you need ad-hoc joins, bulk pulls, or tooling the REST shape doesn't fit. For
everything else — rate-limited, accounted, cached, federated reads — prefer the HTTP API
documented at [`lum.id/findata/usage.md`](https://lum.id/findata/usage.md).

**Host**: `sql.lum.id`
**Port**: `5432`
**Database**: `findata`
**Protocol**: standard Postgres wire protocol (pgbouncer in front of a TimescaleDB/Postgres 17
warehouse)

```
postgresql://lumid_reader:<password>@sql.lum.id:5432/findata?sslmode=verify-full&sslrootcert=sql-ca.pem
```

## Authentication & TLS

There is a single shared read role, `lumid_reader`. Ask an admin for the current password.

The connection is TLS-only with a self-signed CA (anchored on the `lum.id` HTTPS cert rather than
a public CA). **Always use `sslmode=verify-full`, not `require`** — `require` encrypts the wire
but accepts *any* certificate, including an attacker's, so it does not protect against a
man-in-the-middle. `verify-full` is the entire point of publishing the CA.

```bash
curl -O https://lum.id/findata/sql-ca.pem

psql "host=sql.lum.id port=5432 dbname=findata user=lumid_reader \
      sslmode=verify-full sslrootcert=sql-ca.pem"
```

Connecting without `sslmode=verify-full` and the CA file fails closed — this was verified, not
assumed:

| Attempt | Result |
|---|---|
| `sslmode=disable` | refused: `FATAL: SSL required` |
| `sslmode=verify-full` with no CA / wrong CA | refused: certificate verification error |
| `sslmode=verify-full` with the published CA | connects, `TLSv1.3` |

## What you can do

The role is **strictly read-only** at the database level, not just by convention:

```sql
-- both of these are rejected, from any client, regardless of app-level intent
CREATE TABLE scratch(x int);   --> ERROR: cannot execute CREATE TABLE in a read-only transaction
INSERT INTO market.ohlc_daily ...;  --> ERROR: cannot execute INSERT in a read-only transaction
```

Session limits, also enforced server-side:

| Setting | Value |
|---|---|
| `default_transaction_read_only` | `on` |
| `statement_timeout` | `120s` |
| `idle_in_transaction_session_timeout` | `60s` |
| `lock_timeout` | `5s` |
| connection limit | `40` concurrent |

**A query that runs past 120 seconds is cancelled, not slow.** This is normal for a shared
analytics role — it isn't a broken connection. In particular, a naive `SELECT count(*)` on one of
the large hypertables (e.g. `prediction_markets.kalshi_markets` — 49.7M rows / 126&nbsp;GB) will
hit this timeout. Scope your query first:

```sql
-- slow / times out
select count(*) from prediction_markets.kalshi_markets;

-- fast — use a predicate, a LIMIT, or timescaledb_information for hypertable metadata
select count(*) from prediction_markets.kalshi_markets where ticker = 'KXBTC-25AUG';
select * from timescaledb_information.hypertables where hypertable_schema = 'prediction_markets';
```

## Schema orientation

```sql
\dn                                            -- list schemas (22)
select table_schema, count(*) from information_schema.tables
  group by 1 order by 2 desc;                  -- ~9,800 tables
select * from timescaledb_information.hypertables;
```

Published schemas: `market`, `fundamentals`, `estimates`, `events`, `ownership`, `news`,
`prediction_markets`, `macro`, `regulatory`, `instrument`, `md`, `reference`, `public`, plus the
supporting `_timescaledb_internal` / `timescaledb_information` schemas needed to read hypertable
chunks. Internal-only schemas (`raw`, `provenance`, `obs`, `monitoring`, `sync`, `mint`,
`sandbox`) are deliberately not granted.

The two biggest surfaces:

- **`market`** — OHLC hypertables `ohlc_1min` / `ohlc_5min` / `ohlc_daily`
  (`symbol, date, open, high, low, close, adj_close, volume, vwap`), plus `splits`, `dividends`.
- **`prediction_markets`** — 34 tables: `polymarket_markets`, `kalshi_markets`, `matched_pairs`,
  per-venue/interval candles, orderbook snapshots, wallet analytics.

## Example queries

```sql
-- latest close for a symbol
select symbol, date, close from market.ohlc_daily
  where symbol = 'AAPL' order by date desc limit 5;

-- a scoped prediction-market lookup (avoid unscoped counts on kalshi_markets, see above)
select ticker, title, close_time from prediction_markets.kalshi_markets
  where ticker like 'KXBTC%' order by close_time desc limit 5;

-- what tables exist in a schema you haven't used yet
select table_name from information_schema.tables
  where table_schema = 'fundamentals' limit 20;
```

## DuckDB

```sql
INSTALL postgres; LOAD postgres;
ATTACH 'host=sql.lum.id port=5432 dbname=findata user=lumid_reader password=<pw> sslmode=verify-full sslrootcert=sql-ca.pem' AS findata (TYPE postgres, READ_ONLY);
SELECT * FROM findata.market.ohlc_daily WHERE symbol = 'AAPL' ORDER BY date DESC LIMIT 5;
```

## From the Studio chatbox (natural language → SQL)

You don't need a SQL client at all — the **Studio chatbox** (`lum.id/studio`) can run analytical
queries against FinData for you. Select **FinData** in the data-app picker, then ask in plain
English. The model discovers the schema with `data_catalog` and runs read-only SQL with
`data_query` (which POSTs to `/retrieve` — SELECT-only, read-only txn, row cap, statement timeout).

Example prompts:

> Use `data_catalog` on findata to list the schemas, then `data_catalog` on the `market` schema.
> Then `data_query` with `SELECT symbol, date, close FROM market.ohlc_daily WHERE symbol = 'AAPL'
> ORDER BY date DESC LIMIT 5`.

Charts work too — the model can render query results with `save_artifact`.

This works on the `claude-code-*` model path and the default DeepSeek path. Bring-your-own-Claude-Code
instructions are in the LumidOS guide *Query FinData from Claude Code*.

## Notes

- **This is a shared credential.** Everyone connects as `lumid_reader`; there's no per-user
  attribution at the SQL layer (`pg_stat_activity` shows one role, not one identity per session).
  If you need audited, per-user access, use the HTTP API instead — it's the accounted surface.
- **The HTTP API stays the primary surface** for anything rate-sensitive, cached, or
  federation-aware. SQL bypasses all of that; use it for bulk/ad-hoc work the REST shape doesn't
  fit, not as a wholesale replacement.
- If a tool defaults to `sslmode=require`, change it to `verify-full` and point it at the
  downloaded `sql-ca.pem` — otherwise you get encryption without real server authentication.
