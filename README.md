# 水电站机组运行检修管理平台

面向电站台账、机组运行、调速励磁、主变与闸门、大坝渗流位移监测、机组检修与发电计划的一体化水电站运行检修管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 电站台账 | `station` | 水电站 | 电站编号、电站名称、装机容量 |
| 机组运行 | `unit` | 水轮发电机组 | 机组编号、机组型号、额定转速 |
| 调速器 | `governor` | 调速器 | 装置编号、所属机组、油压值 |
| 励磁系统 | `excitation` | 励磁装置 | 装置编号、所属机组、励磁电压 |
| 主变压器 | `transformer` | 主变压器 | 变压器编号、容量等级、油温 |
| 闸门启闭 | `gate` | 闸门 | 闸门编号、闸门类型、孔口尺寸 |
| 渗流监测 | `seepage` | 渗流测点 | 测点编号、测点位置、测压管水位 |
| 位移监测 | `displacement` | 位移测点 | 测点编号、测点高程、水平位移 |
| 拦污栅 | `trashrack` | 拦污栅 | 栅体编号、所属机组、前后压差 |
| 机组检修 | `overhaul` | 检修工作票 | 工作票号、检修机组、检修级别 |
| 导轴承 | `bearing` | 导轴承 | 轴承编号、所属机组、上导温度 |
| 技术供水 | `cooling` | 供水系统 | 系统编号、供水类型、供水压力 |
| 水情调度 | `hydrology` | 水情记录 | 记录编号、观测时间、上游水位 |
| 泄洪操作 | `flood` | 泄洪操作 | 操作编号、泄洪闸号、开启孔数 |
| 发电计划 | `generation` | 发电计划 | 计划编号、计划日期、计划出力 |
| 继电保护 | `protection` | 保护装置 | 装置编号、保护类型、定值单号 |
| 缺陷处置 | `defect` | 设备缺陷 | 缺陷编号、设备名称、缺陷描述 |
| 检修人员 | `crew` | 检修人员 | 人员编号、姓名、岗位 |
| 备品备件 | `spare` | 备品备件 | 备件编号、备件名称、规格型号 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `hydropower-plant-om:entries` 这一项，或调用 `resetModule(模块)`。

## 继电保护到期判定（统一口径）

列表的到期等级、动作里的到期提示、另存归档的排序，原先各写一遍且提前量不同，已收拢为
**唯一实现** `frontend/src/domain/protection/expiry.ts`；配套服务在
`frontend/src/domain/protection/service.ts`，旁路持久化在 `domain/protection/store.ts`。
现场巡视隐患清单页面在 `views/patrol/`。

唯一口径（参数与三档边界只此一份）：

- 校验周期 **365 天**，下次校验日 = 上次校验日 + 365；提前量只保留一个 **30 天**。
- 到期日当天或已逾期 → **待校验**；到期日前 1~30 天 → **即将到期**；31 天以上 → **正常**。
- 定值单号为空 → **未建档**（三档之外），列表与动作提示都说明「请先补建定值单」，不纳入统计。
- 动作次数：以「提交校验」时记录的次数为基线，校验后又动作（次数 > 基线）统一按待校验；
  存量装置没有基线，**不追溯**。

旧数据兼容与既有等级（由实现方决定并在此交代）：

- 装置原表 8 个字段不增不删（另存的列顺序与字段因此不动）；到期等级、判定说明、动作次数基线
  存放在旁路 meta 中。
- **既有判定不改写**：首次判定后等级冻结，之后同一天在任何页面结论一致；冻结等级后又动作的，
  历史等级仍保留在台账中，但展示/提示/排序统一生效为「待校验」（`effectiveTier`）。只有
  「提交校验」会重新定级。
- 早期没有下次校验日：按「上次校验日 + 365 天」**倒推回填**该字段，并在到期说明、台账来源中标注。
- 历史校验记录按上次校验日时间顺序补录，缺项（缺下次校验日等）在「来源」中写清。
- 初始化幂等：按装置编号去重，反复初始化不会多出重复装置、不会重复台账；重置走
  `resetModule('protection')`，装置表与旁路数据一起回到种子。

隐患与另存：

- 待校验/即将到期自动进入现场巡视隐患清单，动作（提交校验、退出运行）的处理结论回写闭环；
  页面条数与导出条数都取自 `openHazards()`，必然相同。
- 另存按版本号归档（默认当天日期）：同版本**整版覆盖**（取最近一次生效），不与旧版叠加；
  排序调用统一的 `compareByDue`。
- 同一时刻的并发写入由同步写锁 + 业务幂等键共同拦截，只保留第一笔，其余按重复处理；
  台账、隐患、导出明细在同一笔写入里同时更新。

验证脚本（需用 esbuild 打包后在 Node 下运行）：

```bash
cd frontend
node -e "require('esbuild').build({entryPoints:['scripts/verify-expiry.ts'],bundle:true,platform:'node',format:'cjs',outfile:'/tmp/v1.cjs'}).then(()=>require('/tmp/v1.cjs'))"
node -e "require('esbuild').build({entryPoints:['scripts/verify-service.ts'],bundle:true,platform:'node',format:'cjs',outfile:'/tmp/v2.cjs'}).then(()=>require('/tmp/v2.cjs'))"
```
