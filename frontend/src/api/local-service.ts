import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  HAZARD_CODE_PREFIX,
  HAZARD_MODULE_KEY,
  PROTECTION_KEY,
  assessProtection,
  assessProtectionRows,
  buildProtectionHazards,
  describeAssessment,
  mergeProtectionHazards,
  migrateProtectionRows,
  sortProtectionByExpiry,
  summarizeProtection,
} from '@/data/protection-expiry'
import type { ProtectionAssessment, ProtectionTier } from '@/data/protection-expiry'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 存量保护装置迁移：按装置编号去重（最近一次生效的覆盖）、按上次校验日回填下次校验日。
// 幂等：再跑一遍 changed=false，不会多出重复装置，也不重复写存储。
function ensureProtectionStore(): void {
  const migration = migrateProtectionRows(listRows(PROTECTION_KEY))
  if (migration.changed) {
    saveRows(PROTECTION_KEY, migration.rows)
  }
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  if (key === PROTECTION_KEY) {
    ensureProtectionStore()
  }
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  if (key === PROTECTION_KEY) {
    ensureProtectionStore()
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  let message = `${meta.entity}已${action}，当前状态「${target}」`
  if (key === PROTECTION_KEY) {
    // 动作提示与列表展示、另存排序共用同一份到期判定，同一天在各处看到的结论一致。
    message += `；到期判定：${describeAssessment(assessProtection(updated))}`
  }
  return { ok: true, message }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  if (key === PROTECTION_KEY) {
    ensureProtectionStore()
  }
  // 另存排序：保护装置按统一到期判定排序，列顺序与字段保持原样。
  const rows = key === PROTECTION_KEY ? sortProtectionByExpiry(listRows(key)) : listRows(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  downloadCsv(filename, content)
}

/** 保护装置到期判定：列表展示用的逐台结论，与动作提示、另存排序同一份实现。 */
export function protectionAssessments(): Map<number, ProtectionAssessment> {
  ensureProtectionStore()
  return assessProtectionRows(listRows(PROTECTION_KEY))
}

/** 保护装置三档（含未建档）汇总，页面统计卡用。 */
export function protectionSummary(): Record<ProtectionTier, number> {
  ensureProtectionStore()
  return summarizeProtection(listRows(PROTECTION_KEY))
}

/** 现场巡视隐患清单里由继电保护回写的条目，页面与导出都读这一份，条数一致。 */
export function listProtectionHazards(): EntryRow[] {
  return listRows(HAZARD_MODULE_KEY).filter((row) =>
    String(row['缺陷编号'] ?? '').startsWith(HAZARD_CODE_PREFIX),
  )
}

/** 把当前到期判定结论回写隐患清单：按最近一次生效的判定整批覆盖，不叠加。 */
export function syncProtectionHazards(): { written: number; removed: number } {
  ensureProtectionStore()
  const hazards = buildProtectionHazards(listRows(PROTECTION_KEY))
  const merged = mergeProtectionHazards(listRows(HAZARD_MODULE_KEY), hazards)
  saveRows(HAZARD_MODULE_KEY, merged.rows)
  return { written: merged.written, removed: merged.removed }
}

export function exportProtectionHazards(): { filename: string; content: string } {
  const meta = moduleMeta(HAZARD_MODULE_KEY)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listProtectionHazards()) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: '继电保护-隐患清单.csv', content: `\uFEFF${lines.join('\n')}` }
}

export function downloadProtectionHazards(): void {
  const { filename, content } = exportProtectionHazards()
  downloadCsv(filename, content)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
