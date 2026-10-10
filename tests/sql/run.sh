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

# early_access_seed.sql 第 2 步：取出写入段，换上测试用的 user_id 实际执行
# 测试资料：A 有星盘；B 没有星盘（相当于那 4 个测试账号）
seed() {  # $1 = ids（逗号分隔、已加引号；空 = 保留文件原样的占位文字），$2 = expected
  sed -n '/^-- >>> 第 2 步开始/,/^-- <<< 第 2 步结束/p' docs/sql/early_access_seed.sql |
    python3 -c '
import sys, re
s = sys.stdin.read()
if sys.argv[1]:
    s = re.sub(r"ids_text text\[\] := array\[.*?\];", "ids_text text[] := array[" + sys.argv[1] + "];", s, flags=re.S)
print(s.replace("expected constant int := 9", "expected constant int := " + sys.argv[2]))' "$1" "$2" |
    psql -q -v ON_ERROR_STOP=1 -d "$DB" 2>&1
}
A="'aaaaaaaa-0000-4000-8000-000000000001'"; B="'bbbbbbbb-0000-4000-8000-000000000002'"
C="'cccccccc-0000-4000-8000-000000000003'"
sq() { psql -tA -d "$DB" -c "$1"; }
expect_seed() {  # $1 = 说明，$2 = 预期讯息，$3 ids，$4 expected，$5 失败后名单应有的笔数（预设 0）
  local o; o=$(seed "$3" "$4") || true
  grep -q "$2" <<<"$o" || { echo "FAIL seed: $1 → $o"; exit 1; }
  if [[ "$2" != 完成* ]]; then
    [ "$(sq 'select count(*) from early_access_users')" = "${5:-0}" ] || { echo "FAIL seed: $1 → 失败时却写入了"; exit 1; }
  fi
  pass=$((pass+1))
}
accounts_before=$(sq 'select count(*) from auth.users')
expect_seed "文件原样（占位文字，还没填入）→ 回滚" "还没填入" "" 9
expect_seed "格式错误 → 回滚" "不是 user_id" "$A,'abc'" 2
expect_seed "人数不符 → 回滚" "预期 9" "$A" 9
expect_seed "重复 user_id → 回滚" "重复" "$A,$A" 2
expect_seed "不存在的 user_id → 回滚" "不存在" "$A,'00000000-0000-4000-8000-000000000000'" 2
expect_seed "没有星盘的测试账号 → 回滚" "没有星盘" "$A,$B" 2
sq "insert into auth.users values ($C); insert into charts (id, user_id, data) values (gen_random_uuid(), $C, '{}')" >/dev/null
expect_seed "有星盘的账号漏贴 → 回滚" "有星盘但不在清单里" "$A" 1
sq "insert into billing_test_users values ($C)" >/dev/null
expect_seed "付款测试账号 → 回滚" "付款测试名单" "$A,$C" 2
sq "delete from auth.users where id = $C; delete from billing_test_users where user_id = $C" >/dev/null
expect_seed "正确清单 → 写入" "完成：1 个 Early User 已在名单中；没有星盘的 1 个账号未加入、未改动" "$A" 1
expect_seed "重跑 → 不重复写入" "完成：1 个" "$A" 1
[ "$(sq "select count(*) from early_access_users where user_id = $A and note like 'Early User%' and scopes = array['topics','life_thread','inner_tools']")" = 1 ] || { echo "FAIL seed: 没有以预设范围写入"; exit 1; }
[ "$(sq "select count(*) from early_access_users where user_id = $B")" = 0 ] || { echo "FAIL seed: 没有星盘的账号被加入"; exit 1; }
[ "$(sq 'select count(*) from auth.users')" = "$((accounts_before + 0))" ] || { echo "FAIL seed: 账号数量改变"; exit 1; }
[ "$(sq 'select (select count(*) from purchases where user_id is not null) + (select count(*) from entitlements) + (select count(*) from subscriptions) + (select count(*) from billing_test_users)')" = 0 ] || { echo "FAIL seed: 不应建立购买、权限或测试名单"; exit 1; }
sq "update early_access_users set scopes = array['topics'] where user_id = $A" >/dev/null
expect_seed "已在名单但范围不是预设 → 回滚" "写入后核对失败" "$A" 1 1
pass=$((pass+4))

# 模拟正式资料：9 个 Early User 都有星盘，另外 4 个测试账号没有星盘（user_id 为测试用，不是真实账号）
sq "delete from early_access_users; delete from charts; delete from auth.users where id <> all (array[$A,$B]::uuid[])" >/dev/null
ids=""
for i in 1 2 3 4 5 6 7 8 9; do
  u="eeeeeeee-0000-4000-8000-00000000000$i"
  sq "insert into auth.users values ('$u'); insert into charts (id, user_id, data) values (gen_random_uuid(), '$u', '{}')" >/dev/null
  ids="$ids${ids:+,}'$u'"
done
for i in 1 2 3 4; do sq "insert into auth.users values ('dddddddd-0000-4000-8000-00000000000$i')" >/dev/null; done
expect_seed "正式资料模拟：9 个 → 写入" "完成：9 个 Early User 已在名单中" "$ids" 9
[ "$(sq "select count(*) from early_access_users where scopes = array['topics','life_thread','inner_tools'] and note like 'Early User%'")" = 9 ] || { echo "FAIL seed: 应写入 9 个"; exit 1; }
[ "$(sq "select count(*) from early_access_users e where not exists (select 1 from charts c where c.user_id = e.user_id)")" = 0 ] || { echo "FAIL seed: 没有星盘的账号被加入"; exit 1; }
[ "$(sq "select count(*) from auth.users where id::text like 'dddddddd%'")" = 4 ] || { echo "FAIL seed: 测试账号被删除"; exit 1; }
expect_seed "正式资料模拟：重跑 → 不重复" "完成：9 个" "$ids" 9
[ "$(sq 'select count(*) from early_access_users')" = 9 ] || { echo "FAIL seed: 重跑后不是 9 个"; exit 1; }
pass=$((pass+4))
echo "SQL 测试全部通过：$pass 项"
