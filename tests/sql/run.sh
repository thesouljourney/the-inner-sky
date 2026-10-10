#!/usr/bin/env bash
# 在本机 PostgreSQL 上验证 docs/sql/payments_stage1.sql（不会连到 Supabase）。
# 用法：PGHOST=/var/run/postgresql PGPORT=5432 PGUSER=postgres tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="inner_sky_sqltest_$$"
psql -q -c "create database $DB"
trap 'psql -q -c "drop database if exists $DB" >/dev/null' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/sql/00_mock_supabase.sql
# 跑两次：确认 migration 可以安全重跑
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f docs/sql/payments_stage1.sql >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f docs/sql/payments_stage1.sql >/dev/null 2>&1
out=$(for f in tests/sql/[1-9]*.sql; do psql -d "$DB" -f "$f" 2>&1; done)
pass=$(grep -c "NOTICE:  ok" <<<"$out" || true)
if grep -qE "ERROR|FAIL" <<<"$out"; then grep -E "ERROR|FAIL" <<<"$out"; echo "通过 $pass，有失败"; exit 1; fi
echo "SQL 测试全部通过：$pass 项"
