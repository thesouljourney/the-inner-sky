#!/usr/bin/env bash
# 在本机 PostgreSQL 上验证 docs/sql/payments_stage1.sql 与 payments_stage1b.sql（不会连到 Supabase）。
# 用法：PGHOST=/var/run/postgresql PGPORT=5432 PGUSER=postgres tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="inner_sky_sqltest_$$"
psql -q -c "create database $DB"
trap 'psql -q -c "drop database if exists $DB" >/dev/null' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/sql/00_mock_supabase.sql
# 跑两次：确认 migration 可以安全重跑
for m in payments_stage1 payments_stage1b; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "docs/sql/$m.sql" >/dev/null 2>&1
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "docs/sql/$m.sql" >/dev/null 2>&1
done
out=$(for f in tests/sql/[1-9]*.sql; do psql -d "$DB" -f "$f" 2>&1 || true; done)
pass=$(grep -c "NOTICE:  ok" <<<"$out" || true)
if grep -qE "ERROR|FAIL" <<<"$out"; then grep -E "ERROR|FAIL" <<<"$out"; echo "通过 $pass，有失败"; exit 1; fi

# early_access_seed.sql 第 2 步：取出注释里的写入段，换上测试用的 user_id 实际执行
seed() {  # $1 = ids（逗号分隔、已加引号），$2 = expected
  sed -n '/^-- begin;/,/^-- commit;/p' docs/sql/early_access_seed.sql | sed 's/^-- //; s/^--$//' |
    python3 -c 'import sys,re; s=sys.stdin.read(); s=re.sub(r"array\[.*?\]::uuid\[\]", "array["+sys.argv[1]+"]::uuid[]", s, flags=re.S); print(s.replace("expected int := 9", "expected int := "+sys.argv[2]))' "$1" "$2" |
    psql -q -v ON_ERROR_STOP=1 -d "$DB" 2>&1
}
A="'aaaaaaaa-0000-4000-8000-000000000001'"; B="'bbbbbbbb-0000-4000-8000-000000000002'"
expect_seed() {  # $1 = 说明，$2 = 预期错误（空 = 应成功），$3 ids，$4 expected
  local o; o=$(seed "$3" "$4") || true
  if [ -z "$2" ]; then grep -q ERROR <<<"$o" && { echo "FAIL seed: $1 → $o"; exit 1; }
  else grep -q "$2" <<<"$o" || { echo "FAIL seed: $1 → $o"; exit 1; }; fi
  pass=$((pass+1))
}
expect_seed "人数不符 → 回滚" "预期 9" "$A" 9
expect_seed "重复 user_id → 回滚" "重复" "$A,$A" 2
expect_seed "不存在的 user_id → 回滚" "不存在" "'00000000-0000-4000-8000-000000000000'" 1
expect_seed "没有星盘 → 回滚" "没有星盘" "$A,$B" 2
psql -q -d "$DB" -c "insert into billing_test_users values ($B)"
psql -q -d "$DB" -c "insert into charts (id, user_id, data) values (gen_random_uuid(), $B, '{}')"
expect_seed "付款测试账号 → 回滚" "付款测试名单" "$A,$B" 2
[ "$(psql -tA -d "$DB" -c 'select count(*) from early_access_users')" = 0 ] || { echo "FAIL seed: 失败时不应写入"; exit 1; }; pass=$((pass+1))
expect_seed "正确清单 → 写入" "" "$A" 1
expect_seed "重跑 → 不重复写入" "" "$A" 1
[ "$(psql -tA -d "$DB" -c "select count(*) from early_access_users where user_id = $A and note like 'Early User%'")" = 1 ] || { echo "FAIL seed: 没有写入"; exit 1; }
[ "$(psql -tA -d "$DB" -c 'select (select count(*) from purchases where user_id is not null) + (select count(*) from entitlements) + (select count(*) from subscriptions)')" = 0 ] || { echo "FAIL seed: 不应建立购买或权限"; exit 1; }
pass=$((pass+2))
echo "SQL 测试全部通过：$pass 项"
