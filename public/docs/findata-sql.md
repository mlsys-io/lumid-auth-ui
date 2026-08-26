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
postgresql://sql_<you>:<minted-password>@sql.lum.id:5432/findata?sslmode=verify-full&sslrootcert=sql-ca.pem
```

## Authentication & TLS

**You connect as your own role, `sql_<name>`, with a password you mint yourself.** There is no
shared account and no password to ask anyone for.

Go to **[Account → FinData SQL](/studio/account/findata-sql)** and press **Generate
credential**. The page shows the password and a ready-made connection string **once** — it is
not recoverable afterwards, exactly like a personal access token. If you lose it, mint a new
one; that is a normal operation, not an incident.

Three things follow from the credential being yours:

- **It expires after 90 days.** The panel shows the time remaining and rotates
  with one click. The number is read from the API rather than written here, so if
  this ever disagrees with the panel, believe the panel.
  A client that suddenly cannot connect has usually just hit this.
- **Rotating replaces the old password immediately.** Update anything that stored it.
- **Revoking terminates live sessions**, not just future ones. The panel reports how many.

> **Two prerequisites, and they are different things.** SQL access needs a `findata` **access
> grant** (an operator applies it, or you redeem an invitation code carrying `findata:read`),
> and then a `sql_<name>` **role** provisioned on the warehouse. The panel tells you which of
> the two you are missing. Note a `findata:read` **PAT scope** is a *third*, unrelated thing —
> minting that scope does not open SQL, and this trips people up.
>
> **You do not need any of this to query FinData in chat.** The Studio chatbox answers
> warehouse questions for every signed-in user with no grant at all. SQL is the gated path
> because it is a direct, unmetered connection to 1.7 TB of production data; chat is
> rate-limited, accounted, and runs through a service credential. If you were denied here,
> chat still works.

The connection is TLS-only with a self-signed CA (anchored on the `lum.id` HTTPS cert rather than
a public CA). **Always use `sslmode=verify-full`, not `require`** — `require` encrypts the wire
but accepts *any* certificate, including an attacker's, so it does not protect against a
man-in-the-middle. `verify-full` is the entire point of publishing the CA.

```bash
curl -O https://lum.id/findata/sql-ca.pem

psql "host=sql.lum.id port=5432 dbname=findata user=sql_<you> \
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

Your role is **strictly read-only** at the database level, not just by convention:

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
| connection limit | `4` concurrent, per person |

These are set on **your** role, not inherited from a group — `ALTER ROLE … SET` does not
inherit through membership, so each role carries its own copy.

The connection limit is 4 rather than a large number because the warehouse has a finite
connection ceiling shared with the apps that serve `lum.id`. The proxy queues past it instead of
letting Postgres start refusing connections to everything else. Four is enough for a GUI client
plus a notebook; if you genuinely need more, say so rather than opening a second account.

**A query that runs past 120 seconds is cancelled, not slow.** It isn't a broken connection.
In particular, a naive `SELECT count(*)` on one of
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
ATTACH 'host=sql.lum.id port=5432 dbname=findata user=sql_<you> password=<minted> sslmode=verify-full sslrootcert=sql-ca.pem' AS findata (TYPE postgres, READ_ONLY);
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

- **This is your own credential, not a shared one.** Every session is attributable: your role
  is what shows up in `pg_stat_activity`, so a runaway query has an owner, and revoking your
  access cannot disturb anyone else. Suspending a lum.id account revokes its warehouse access
  with it — which is the property a hand-distributed shared password could never have.
- **Mint it, do not store it forever.** The credential is short-lived on purpose. Rotate from
  the panel rather than keeping one password alive indefinitely.
- **The HTTP API stays the primary surface** for anything rate-sensitive, cached, or
  federation-aware. SQL bypasses all of that; use it for bulk/ad-hoc work the REST shape doesn't
  fit, not as a wholesale replacement.
- If a tool defaults to `sslmode=require`, change it to `verify-full` and point it at the
  downloaded `sql-ca.pem` — otherwise you get encryption without real server authentication.
