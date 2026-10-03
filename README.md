# 区域高亮地图（map_ai）

在浏览器里用的地图工具：**输入地名 → 半透明高亮它的真实范围**，可以一次高亮很多块、颜色互不重复，用来比较形状、大小与相互距离。附带标准/卫星双底图、手绘描边、多点测距、两点路径规划。

纯前端 + 零 npm 依赖（Leaflet 已本地化到 `vendor/`），不需要构建步骤。

---

## 快速开始

```bash
cd map_ai
node serve.mjs          # 或双击 启动.bat（会顺便打开浏览器）
```

浏览器打开 <http://localhost:8080>。**不启动服务也能用**：直接双击 `index.html` 即可，只是此时无法配置高德 key、且部分跨源请求会被浏览器拦掉，所以推荐走 `serve.mjs`。

`serve.mjs` 做两件事：静态文件服务 + `/api/*` 反向代理（amap / datav / osrm / photon / esri / nominatim / overpass）。高德的 key 由服务端注入，**不会出现在前端代码与 git 里**。

## 要不要注册高德 key

不配 key 也够用，功能差别如下：

| 能力 | 免 key | 配 key |
|---|---|---|
| 国/省/市/区县 行政区高亮（含面积、周长、展开下级） | ✅ 阿里云 DataV | ✅ |
| 手绘任意区域、多点测距 | ✅ | ✅ |
| 两点路径规划 | ✅ OSRM（境外引擎，国内路网偏粗）+ Photon 地址解析 | ✅ 高德驾车/步行/骑行/公交，含国内真实路网与耗时 |
| 兴趣点（学校/小区/公园）搜索与**真实轮廓** | ❌ 只能打点 + 提示改用描边 | ✅ 取决于接口是否返回 AOI 边界字段 |

配 key 方法：

1. 打开 <https://lbs.amap.com> → 注册 → 实名认证（个人开发者免费配额足够）。
2. 控制台 → 创建应用 → 添加 key → 服务平台选 **Web服务**（不是 Web端 JS API）。
3. 复制 `config.example.json` 为 `config.json`，把 key 填进 `amapKey`，重启 `serve.mjs`。
4. 想看接口到底给了哪些字段（尤其有没有轮廓）：`node scripts/probe-amap.mjs 华南农业大学 广州`，完整响应会写到 `.amap-probe.json`。

`config.json` 已在 `.gitignore` 里，不会误提交。

## 操作说明

**搜索高亮** — 顶部输入框输入地名，下拉里点一条或按回车。结果会标注类型：`[行政区·区县级]` / `[POI·高校]` / `[手绘]`。

**展开下级** — 面板右上角的复选框。勾上后搜「广州市」会把 11 个区县各上一色一次画出；搜省同理。

**右键** —
- 在高亮区域上右键：`取消高亮`、`仅保留这一块`、`复制名称与面积`；
- 在空白处右键：`设为路径起点/终点`、`从这里开始绘制区域`、`测距：从此处开始`、`高亮此处所属行政区`（后者需 key）。

**左键永远穿透** — 高亮面放在独立图层且设为非交互，所以在高亮区域里选点、描边、测距都不受影响。

**绘制区域** — 顶栏「绘制区域」→ 左键沿边界逐点点击（状态栏实时显示面积）→ 右键或回车闭合 → 命名。`Ctrl+Z` 撤销上一个点，`Esc` 退出。建议先切「卫星」图照着描。

**测距** — 顶栏「测距」→ 左键逐点点击，每段与合计直线距离都会标在图上；`Esc` 清除。

**路径** — 顶栏「路径」→ 起终点填地址或直接填 `纬度,经度` → 选驾车/步行/骑行/公交 → 规划。

**其他** — 「全部区域」缩放到能看见所有高亮；「清除」清空；右侧面板每块区域有 `定位 / 复制 / 删除`，鼠标悬停会加深该块；≥2 块时面板下方给出**两两质心直线距离矩阵**。高亮集合存在 localStorage，刷新后自动恢复。

快捷键：`Esc` 退出当前工具 / `Enter` 闭合描边 / `Ctrl+Z` 撤销顶点。

## 数据源与坐标系

- 底图瓦片：高德 `webrd0x style=8`（标准）、`webst0x style=6`（卫星）+ `style=8`（路网注记叠加），备用 Esri World Imagery。
- 行政区面：阿里云 DataV.GeoAtlas `geo.datav.aliyun.com/areas_v3/bound/{adcode}[_full].json`，免费、允许跨源。**最细到区县级**（乡镇街道接口不开放），所以更小的范围请用「绘制区域」。
- 名称→adcode 索引：`data/admin-index.json`，由 `scripts/build-admin-index.mjs` 从 modood/Administrative-divisions-of-China（GB/T 2260）抓取生成，共 3343 条（国 1 / 省 34 / 市 333 / 区县 2975）。重新生成：`node scripts/build-admin-index.mjs`。
- 底图与 DataV 边界同为 **GCJ-02**，实测在 15 级下区界与珠江岸线、道路贴合，无需纠偏。OSRM / Photon 是 **WGS84**，代码里经 `src/geom/coortransform.js` 转换后再画，所以路线能压在路网上。
- 面积用球面多边形公式（`R=6371008.8`）本地算，不依赖任何接口：天河区 137 km²（官方 137.39）、广州 11 个区县合计 7415 km²（官方 7434，误差 0.25%）。

## 自检

```bash
node --test tests/geom.test.mjs      # 8 项：面积公式、haversine、点在面内（带洞）、坐标互转、真实边界面积
node scripts/probe-sources.mjs       # 打印当前网络下各数据源可用性
```

## 已知限制（说实话）

- 本机网络下 **Nominatim / Overpass / tile.openstreetmap.org 全部不可达**（前者超时、Overpass 返回 406、OSM 瓦片 DNS 失败），所以「输入任意 POI 就自动出现真实轮廓」只能靠高德 key，且取决于高德是否对该 POI 返回 AOI 边界；拿不到轮廓时，程序会明确提示改用「绘制区域」，不会假装成功。
- 高德 key 的个人配额有限，且 `restapi` 对无 referer 的服务端调用有 QPS 限制；批量抓取请自行加间隔。
- `启动.bat` 固定打开 8080 端口；若在 `config.json` 改了 `port`，请手动访问对应端口。
- 手绘区域只存顶点，不保存影像底图快照；换设备需要同步的话得自己导出。
- 高亮色板预设 8 色，超出后按黄金角色相自动生成，仍保证互不相同。

## 目录

```
index.html  styles/  vendor/leaflet.{js,css}
src/main.js              装配与全局交互（右键菜单、快捷键、状态栏）
src/config.js            读取配置、决定走代理还是直连
src/layers/basemaps.js   标准/卫星/注记图层
src/geom/                geo.js（面积/距离/点在面内/格式化）、coortransform.js（GCJ↔WGS）
src/data/                datav.js amap.js osm.js admin-index.js
src/highlight/           store.js（集合/配色/持久化/命中）、render.js（矢量面渲染）
src/ui/                  search.js panel.js contextmenu.js draw.js measure.js route.js
data/admin-index.json    行政区名称索引
serve.mjs  启动.bat  config.example.json
scripts/                 build-admin-index.mjs probe-sources.mjs probe-amap.mjs
tests/geom.test.mjs
```
