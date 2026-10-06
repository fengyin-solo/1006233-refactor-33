import { listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

import {
  CALIBRATION_INTERVAL_DAYS,
  SOON_DAYS,
  TIER,
  UNFILED,
  addDays,
  compareByDue,
  deriveNextDate,
  effectiveTier,
  judgeRow,
  tierLabel,
  todayLocal,
  type ProtectionTier,
} from './expiry'
import {
  allHazards,
  allLedger,
  allProtectionMeta,
  allSnapshots,
  protectionMetaOf,
  saveHazards,
  saveLedger,
  saveProtectionMeta,
  saveSnapshots,
  type PatrolHazard,
  type ProtectionDeviceMeta,
  type ProtectionLedgerEntry,
  type ProtectionSnapshot,
} from './store'

/**
 * 继电保护业务服务：列表展示、动作提示、另存排序都经此调用 expiry.ts 的唯一判定。
 * 装置原表 8 个字段不增不删（下次校验日对存量缺失做一次性倒推回填），
 * 冻结结论放旁路 meta，历史记录、隐患、另存版本各自独立存储。
 */

export const PROTECTION_KEY = 'protection'
const DEVICE_NO = '装置编号'
const DEVICE_TYPE = '保护类型'
const SETTING_NO = '定值单号'
const LAST_DATE = '上次校验日'
const NEXT_DATE = '下次校验日'
const ACTION_COUNT = '动作次数'

// 同一时刻的并发写入：纯前端同步执行，用写锁挡住同一调用栈里的重入；
// 业务唯一键再挡一次重复提交，只让一笔生效，其余按重复处理。
const writeLocks = new Set<string>()

function withWriteLock<T>(scope: string, key: string, fn: () => T, duplicate: T): T {
  const lockKey = `${scope}:${key}`
  if (writeLocks.has(lockKey)) {
    return duplicate
  }
  writeLocks.add(lockKey)
  try {
    return fn()
  } finally {
    writeLocks.delete(lockKey)
  }
}

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function nowStamp(): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function nextLedgerId(entries: ProtectionLedgerEntry[]): number {
  return entries.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

function nextHazardId(entries: PatrolHazard[]): number {
  return entries.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

// ---------------------------------------------------------------------------
// 初始化 / 存量回填（幂等：反复执行不会多出重复装置，已有结论不改写）
// ---------------------------------------------------------------------------

let initialized = false

export function ensureProtectionInitialized(): void {
  if (initialized) {
    return
  }
  withWriteLock('protection-init', 'singleton', migrate, undefined as never)
  initialized = true
}

function migrate(): void {
  const rows = listRows(PROTECTION_KEY).map((row) => ({ ...row }))
  const metaTable = { ...allProtectionMeta() }
  const ledger = allLedger()
  const knownLedger = new Set(
    ledger.map((item) => `${item.装置编号}|${item.上次校验日}|${item.结论}`),
  )
  const seenDevices = new Set<string>()
  let changed = false

  for (const row of rows) {
    const deviceNo = text(row, DEVICE_NO)
    // 装置编号缺失或重复：只保留一笔，其余跳过，保证初始化不产生重复装置。
    if (!deviceNo || seenDevices.has(deviceNo)) {
      continue
    }
    seenDevices.add(deviceNo)

    // 早期没有下次校验日：按上次校验日 + 一个周期倒推回填（原结论与原字段不受影响）。
    let derived = false
    if (!text(row, NEXT_DATE) && text(row, LAST_DATE)) {
      const derivedDate = deriveNextDate(text(row, LAST_DATE))
      if (derivedDate) {
        row[NEXT_DATE] = derivedDate
        derived = true
        changed = true
      }
    }

    const verdict = judgeRow(row, metaTable[deviceNo] ?? null)
    if (!metaTable[deviceNo] && !verdict.unfiled && verdict.tier) {
      metaTable[deviceNo] = {
        装置编号: deviceNo,
        到期等级: verdict.tier,
        判定到期日: verdict.dueDate,
        判定基准日: todayLocal(),
        下次校验日倒推: derived || verdict.derived,
        判定说明: `存量装置按上次校验日回填：${verdict.reason}`,
        动作次数基线: null,
        更新时间: nowStamp(),
      }
    }

    // 历史校验记录按上次校验日保留原结论；缺项来源写清楚，缺哪条只补哪条。
    if (text(row, LAST_DATE)) {
      const source = metaTable[deviceNo]?.下次校验日倒推
        ? `存量回填（原台账缺下次校验日，按上次校验日 + ${CALIBRATION_INTERVAL_DAYS} 天倒推）`
        : '存量回填（按上次校验日保留原结论）'
      const signature = `${deviceNo}|${text(row, LAST_DATE)}|等级冻结为「${verdict.unfiled ? UNFILED : verdict.tier}」`
      if (!knownLedger.has(signature)) {
        knownLedger.add(signature)
        ledger.push({
          id: nextLedgerId(ledger),
          装置编号: deviceNo,
          上次校验日: text(row, LAST_DATE),
          下次校验日: text(row, NEXT_DATE) || null,
          到期等级: verdict.unfiled ? null : verdict.tier,
          结论: `等级冻结为「${verdict.unfiled ? UNFILED : verdict.tier}」`,
          动作次数: Number(row[ACTION_COUNT] ?? 0) || 0,
          来源: `${source}；${verdict.reason}`,
          记录时间: nowStamp(),
        })
      }
    }
  }

  // 台账按时间顺序（上次校验日）补录，同日按装置编号。
  ledger.sort((a, b) =>
    a.上次校验日 === b.上次校验日
      ? a.装置编号.localeCompare(b.装置编号)
      : a.上次校验日.localeCompare(b.上次校验日),
  )

  if (changed) {
    saveRows(PROTECTION_KEY, rows)
  }
  saveProtectionMeta(metaTable)
  saveLedger(ledger)
  syncHazards(rows, metaTable, '初始化同步')
}

// ---------------------------------------------------------------------------
// 隐患清单：处理结论由动作回写；页面与导出共用同一份过滤结果，条数必然相同
// ---------------------------------------------------------------------------

function riskDescription(tier: ProtectionTier, reason: string): string {
  if (tier === TIER.PENDING) return `保护装置已到期待校验：${reason}`
  return `保护装置即将到期，需提前安排校验：${reason}`
}

/** 以当前装置结论为准重算在办隐患：待校验/即将到期在办，正常/未建档/已退出的在办项闭环。 */
function syncHazards(
  rows: EntryRow[],
  metaTable: Record<string, ProtectionDeviceMeta>,
  trigger: string,
): PatrolHazard[] {
  const hazards = allHazards()
  const atRisk = new Map<string, { tier: ProtectionTier; reason: string; type: string }>()
  for (const row of rows) {
    if (text(row, 'status') === '已退出') continue
    const verdict = judgeRow(row, metaTable[text(row, DEVICE_NO)] ?? null)
    const effective = effectiveTier(verdict)
    if (effective === TIER.PENDING || effective === TIER.SOON) {
      atRisk.set(text(row, DEVICE_NO), {
        tier: effective,
        reason: verdict.reason,
        type: text(row, DEVICE_TYPE),
      })
    }
  }

  const today = todayLocal()
  for (const hazard of hazards) {
    if (hazard.处理状态 === '在办' && !atRisk.has(hazard.装置编号)) {
      hazard.处理状态 = '已闭环'
      hazard.处理结论 = hazard.处理结论 || `${trigger}时复核：装置已不属待校验/即将到期`
      hazard.处理时间 = hazard.处理时间 || nowStamp()
      hazard.最近提示日 = today
    }
  }

  for (const [deviceNo, info] of atRisk) {
    const existing = hazards.find((item) => item.装置编号 === deviceNo && item.处理状态 === '在办')
    if (existing) {
      existing.到期等级 = info.tier
      existing.隐患描述 = riskDescription(info.tier, info.reason)
      existing.最近提示日 = today
      continue
    }
    hazards.push({
      id: nextHazardId(hazards),
      装置编号: deviceNo,
      保护类型: info.type,
      隐患描述: riskDescription(info.tier, info.reason),
      到期等级: info.tier,
      发现日期: today,
      最近提示日: today,
      处理状态: '在办',
      处理结论: '',
      处理时间: '',
    })
  }

  saveHazards(hazards)
  return hazards
}

/** 动作把处理结论回写到该装置在办隐患（一台装置只回写一条）。 */
function resolveHazard(deviceNo: string, conclusion: string): void {
  const hazards = allHazards()
  const open = hazards.find((item) => item.装置编号 === deviceNo && item.处理状态 === '在办')
  if (open) {
    open.处理状态 = '已闭环'
    open.处理结论 = conclusion
    open.处理时间 = nowStamp()
    saveHazards(hazards)
  }
}

export function openHazards(): PatrolHazard[] {
  ensureProtectionInitialized()
  return allHazards().filter((item) => item.处理状态 === '在办')
}

// ---------------------------------------------------------------------------
// 列表展示：到期等级、到期说明全部取自统一判定，页面不自己算
// ---------------------------------------------------------------------------

export type ProtectionRow = EntryRow & {
  到期等级: string
  到期说明: string
}

export function listProtectionRows(): ProtectionRow[] {
  ensureProtectionInitialized()
  const rows = listRows(PROTECTION_KEY)
  const metaTable = allProtectionMeta()
  return rows.map((row) => {
    const verdict = judgeRow(row, metaTable[text(row, DEVICE_NO)] ?? null)
    return {
      ...row,
      到期等级: tierLabel(verdict),
      到期说明: verdict.reason,
    }
  })
}

export function protectionStats(rows?: ProtectionRow[]): { label: string; value: number }[] {
  const items = rows ?? listProtectionRows()
  const active = items.filter((row) => String(row.status) !== '已退出')
  return [
    { label: '正常保护装置', value: active.filter((row) => row.到期等级 === TIER.NORMAL).length },
    { label: '待校验装置', value: active.filter((row) => row.到期等级 === TIER.PENDING).length },
    { label: '即将到期装置', value: active.filter((row) => row.到期等级 === TIER.SOON).length },
  ]
}

/** 动作前的到期提示：和列表、另存是同一份判定，只负责把结论说成人话。 */
export function dueNotice(row: EntryRow): string {
  ensureProtectionInitialized()
  const verdict = judgeRow(row, protectionMetaOf(text(row, DEVICE_NO)))
  if (verdict.unfiled) {
    return `提示：${verdict.reason}`
  }
  const tier = effectiveTier(verdict)
  if (tier === TIER.PENDING) {
    return `提示：装置${verdict.daysLeft === 0 ? '今天到期' : '已到期待校验'}（${verdict.actionPending ? '校验后又动作' : '已逾期或到校验日'}），请尽快提交校验`
  }
  if (tier === TIER.SOON) {
    return `提示：距下次校验还有 ${verdict.daysLeft} 天（提前 ${SOON_DAYS} 天），请提前安排`
  }
  return `提示：距下次校验还有 ${verdict.daysLeft} 天，状态正常`
}

// ---------------------------------------------------------------------------
// 动作：提交校验 / 标记异常 / 退出运行；提交校验是唯一会重新定级的动作
// ---------------------------------------------------------------------------

function appendLedger(entry: Omit<ProtectionLedgerEntry, 'id'>): void {
  const ledger = allLedger()
  const signature = `${entry.装置编号}|${entry.上次校验日}|${entry.结论}`
  if (ledger.some((item) => `${item.装置编号}|${item.上次校验日}|${item.结论}` === signature)) {
    return
  }
  ledger.push({ ...entry, id: nextLedgerId(ledger) })
  ledger.sort((a, b) =>
    a.上次校验日 === b.上次校验日
      ? a.装置编号.localeCompare(b.装置编号)
      : a.上次校验日.localeCompare(b.上次校验日),
  )
  saveLedger(ledger)
}

export function runProtectionAction(id: number, action: string): ActionResult {
  ensureProtectionInitialized()
  const rows = listRows(PROTECTION_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的保护装置` }
  }
  const original = rows[index]
  const deviceNo = text(original, DEVICE_NO)
  if (!text(original, SETTING_NO)) {
    return { ok: false, message: '定值单号为空，按未建档处理：请先补建定值单与校验档案后再操作' }
  }

  // 业务层幂等：顺序重复点击（写锁之外）也只能保留一笔，其余按重复处理。
  if (action === '提交校验' && text(original, LAST_DATE) === todayLocal()) {
    return { ok: false, message: '该装置今天已提交过校验，重复提交只保留第一笔' }
  }
  if (action === '标记异常' && text(original, 'status') === '异常') {
    return { ok: false, message: '保护装置已是「异常」，重复操作只保留第一笔' }
  }
  if (action === '退出运行' && text(original, 'status') === '已退出') {
    return { ok: false, message: '保护装置已退出运行，重复操作只保留第一笔' }
  }

  const signature = `${id}|${action}|${original.status}|${original[ACTION_COUNT] ?? ''}|${original[LAST_DATE] ?? ''}`
  const duplicate: ActionResult = { ok: false, message: '该处理正在写入，已按重复提交处理，只保留第一笔' }

  return withWriteLock(
    'protection-action',
    signature,
    () => {
      const current = { ...rows[index] }
      const metaTable = { ...allProtectionMeta() }
      let target = ''
      let pending = true
      let abnormal = false

      if (action === '提交校验') {
        target = '正常'
        const today = todayLocal()
        const actionCount = Number(current[ACTION_COUNT] ?? 0) || 0
        // 提交校验：上次/下次校验日、动作次数基线一起更新，并用唯一实现重新定级。
        current[LAST_DATE] = today
        current[NEXT_DATE] = addDays(today, CALIBRATION_INTERVAL_DAYS)
        current.status = target
        current.pending = true
        current.abnormal = false
        const verdict = judgeRow(current, null)
        metaTable[deviceNo] = {
          装置编号: deviceNo,
          到期等级: (verdict.tier ?? TIER.NORMAL) as ProtectionTier,
          判定到期日: verdict.dueDate,
          判定基准日: today,
          下次校验日倒推: false,
          判定说明: `提交校验后重新判定：${verdict.reason}`,
          动作次数基线: actionCount,
          更新时间: nowStamp(),
        }
        // 台账与导出明细在同一笔写入里同时更新。
        appendLedger({
          装置编号: deviceNo,
          上次校验日: today,
          下次校验日: text(current, NEXT_DATE) || null,
          到期等级: verdict.tier,
          结论: `提交校验，等级重判为「${verdict.tier}」`,
          动作次数: actionCount,
          来源: '现场提交校验',
          记录时间: nowStamp(),
        })
        resolveHazard(deviceNo, `已于 ${today} 完成校验，隐患闭环`)
      } else if (action === '标记异常') {
        target = '异常'
        abnormal = true
        current.status = target
        current.abnormal = true
      } else if (action === '退出运行') {
        target = '已退出'
        pending = false
        current.status = target
        current.pending = false
        resolveHazard(deviceNo, '装置已退出运行，隐患随设备退出闭环')
      } else {
        return { ok: false, message: `保护装置没有登记「${action}」这个动作` }
      }

      if (target && action !== '提交校验') {
        current.pending = pending
      }
      if (abnormal) {
        current.abnormal = true
      }

      const next = [...rows]
      next[index] = current
      saveRows(PROTECTION_KEY, next)
      saveProtectionMeta(metaTable)
      syncHazards(next, metaTable, `执行「${action}」`)

      const verdict = judgeRow(current, metaTable[deviceNo])
      const daysText = verdict.daysLeft === null ? '' : `；${dueNotice(current)}`
      return {
        ok: true,
        message: `保护装置已${action}，当前状态「${target}」，到期等级「${tierLabel(verdict)}」${daysText}`,
      }
    },
    duplicate,
  )
}

// ---------------------------------------------------------------------------
// 导出：清单 / 隐患 / 台账明细都与页面同源同时更新
// ---------------------------------------------------------------------------

function csvCell(value: unknown): string {
  const textValue = String(value ?? '')
  return /[",\n]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue
}

function toCsv(header: string[], lines: unknown[][]): string {
  const all = [header, ...lines]
  return `﻿${all.map((line) => line.map(csvCell).join(',')).join('\n')}`
}

/** 保护清单：字段与列顺序沿用装置原表，不动。 */
export function exportProtectionCsv(): { filename: string; content: string } {
  const rows = listProtectionRows()
  const header = ['编号', '装置编号', '保护类型', '定值单号', '上次校验日', '下次校验日', '动作次数', '校验人员', '装置状态', '当前状态', '到期等级']
  const lines = rows.map((row) => [
    row.id,
    row['装置编号'],
    row['保护类型'],
    row['定值单号'],
    row['上次校验日'],
    row['下次校验日'],
    row['动作次数'],
    row['校验人员'],
    row['装置状态'],
    row.status,
    tierLabel(judgeRow(row, allProtectionMeta()[text(row, DEVICE_NO)] ?? null)),
  ])
  return { filename: '继电保护-清单.csv', content: toCsv(header, lines) }
}

/** 现场巡视隐患清单：页面条数与导出行数都取自 openHazards()。 */
export function exportHazardsCsv(): { filename: string; content: string; count: number } {
  const hazards = openHazards()
  const header = ['编号', '装置编号', '保护类型', '隐患描述', '到期等级', '发现日期', '最近提示日', '处理状态', '处理结论']
  const lines = hazards.map((item) => [
    item.id,
    item.装置编号,
    item.保护类型,
    item.隐患描述,
    item.到期等级 ?? UNFILED,
    item.发现日期,
    item.最近提示日,
    item.处理状态,
    item.处理结论,
  ])
  return {
    filename: '现场巡视-继电保护隐患清单.csv',
    content: toCsv(header, lines),
    count: hazards.length,
  }
}

/** 历史校验台账明细：导出的就是 store 里那份台账，随动作同时更新。 */
export function exportLedgerCsv(): { filename: string; content: string; count: number } {
  ensureProtectionInitialized()
  const ledger = allLedger()
  const header = ['编号', '装置编号', '上次校验日', '下次校验日', '到期等级', '结论', '动作次数', '来源', '记录时间']
  const lines = ledger.map((item) => [
    item.id,
    item.装置编号,
    item.上次校验日,
    item.下次校验日 ?? '',
    item.到期等级 ?? UNFILED,
    item.结论,
    item.动作次数,
    item.来源,
    item.记录时间,
  ])
  return { filename: '继电保护-历史校验台账.csv', content: toCsv(header, lines), count: ledger.length }
}

// ---------------------------------------------------------------------------
// 另存归档：同一版本整版覆盖（最近一次生效的一版），排序走统一判定
// ---------------------------------------------------------------------------

export function saveSnapshotAs(version?: string): {
  ok: boolean
  message: string
  version: string
  count: number
} {
  ensureProtectionInitialized()
  const versionNo = (version ?? todayLocal()).trim()
  if (!versionNo) {
    return { ok: false, message: '版本号不能为空', version: '', count: 0 }
  }
  const duplicate = {
    ok: false,
    message: `另存版本「${versionNo}」正在写入，已按重复处理，只保留第一笔`,
    version: versionNo,
    count: 0,
  }
  return withWriteLock(
    'protection-snapshot',
    versionNo,
    () => {
      const metaTable = allProtectionMeta()
      // 排序只此一处：待校验 → 即将到期 → 正常 → 未建档，同档按到期日。
      const ordered = [...listRows(PROTECTION_KEY)]
        .map((row) => ({ row, verdict: judgeRow(row, metaTable[text(row, DEVICE_NO)] ?? null) }))
        .sort((a, b) =>
          compareByDue(
            { verdict: a.verdict, deviceNo: String(a.row[DEVICE_NO] ?? '') },
            { verdict: b.verdict, deviceNo: String(b.row[DEVICE_NO] ?? '') },
          ),
        )
        .map((item) => ({ ...item.row }))

      // 覆盖旧版本：同版本键整版替换，绝不与上一版结果叠加。
      const snapshots = allSnapshots()
      snapshots[versionNo] = {
        版本号: versionNo,
        生成时间: nowStamp(),
        rows: ordered,
      }
      saveSnapshots(snapshots)
      return {
        ok: true,
        message: `已另存版本「${versionNo}」，共 ${ordered.length} 台；同版本旧结果已整版覆盖`,
        version: versionNo,
        count: ordered.length,
      }
    },
    duplicate,
  )
}

export function listSnapshots(): ProtectionSnapshot[] {
  ensureProtectionInitialized()
  return Object.values(allSnapshots()).sort((a, b) => b.版本号.localeCompare(a.版本号))
}

/** 重置：装置表回到种子，旁路结论/台账/隐患/另存一并清空，再按种子重新回填一遍。 */
export function resetProtection(): void {
  resetRows(PROTECTION_KEY)
  saveProtectionMeta({})
  saveLedger([])
  saveHazards([])
  saveSnapshots({})
  initialized = false
  ensureProtectionInitialized()
}
