# tools/ —— 建置期脚本

平常开发不需要跑这些;只有要**更新星历表、地点资料或测试对照**时才用。
产物已经 commit 进 `assets/astro/` 与 `tests/reference/`。

## 前置

```bash
npm install                 # Node 端(astronomy-engine 等)
pip install pyswisseph      # Python 端
```

Swiss Ephemeris 资料档**没有** commit 进仓库(授权与体积考量)。需要时放到 `tools/ephe/`:

```bash
mkdir -p tools/ephe && cd tools/ephe
for f in sepl_18.se1 semo_18.se1 seas_18.se1; do
  curl -LO "https://raw.githubusercontent.com/aloistr/swisseph/master/ephe/$f"
done
```

`_18` 系列涵盖西元 1800–2400,足够所有出生盘。

## 脚本

| 脚本 | 产物 | 何时要重跑 |
| --- | --- | --- |
| `gen-ephem-swiss.py` | `tools/ephem-swiss.json` | 要改分段参数、或加天体时 |
| `gen-ephem-minor.js` | `assets/astro/ephem-minor.js` | 同上(要先跑上面那支) |
| `gen-places.js` | `assets/astro/places-data.js` | GeoNames 更新、或要调收录门槛时 |
| `gen-reference.py` | `tests/reference/cases.json` | 要增删校准案例时 |

```bash
python3 tools/gen-ephem-swiss.py     # 先
node    tools/gen-ephem-minor.js     # 后(会读上一步的 json)
node    tools/gen-places.js
python3 tools/gen-reference.py
npm test
```

`gen-ephem-minor.js` 还会用 Astronomy Engine 的 `GravitySimulator` 做 N 体积分,
处理三颗没有 Swiss 星历档的小行星(爱神 433 / 赛姬 16 / 阋神)。整支约 10 秒。
