import type { EntryRow } from './types'

// 继电保护到期判定：全仓库只有这一份实现。
// 列表展示、动作提示、另存排序、隐患清单回写都调这里；
// 正常 / 待校验 / 即将到期三档的边界只在这一处定义，不再各处各算一遍。

export const PROTECTION_KEY = 'protection'
// 现场巡视发现的隐患落在「缺陷处置」台账里，编号带统一前缀，回写时按最近一次判定整批覆盖。
export const HAZARD_MODULE_KEY = 'defect'
export const HAZARD_CODE_PREFIX = 'PROT-HZ-'

// 判定参数与三档边界，只此一份：
export const REVIEW_CYCLE_DAYS = 365 // 校验周期：早期记录缺下次校验日时，按 上次校验日+周期 倒推
export const DUE_SOON_LEAD_DAYS = 30 // 提前量：距下次校验日不超过 30 天判「即将到期」
export const ACTION_COUNT_LIMIT = 30 // 动作次数上限：达到即判「待校验」，不再等日期

export type ProtectionTier = '正常' | '待校验' | '即将到期' | '未建档'

export type ProtectionAssessment = {
  tier: ProtectionTier
  lastCheckDate: string | null // 上次校验日（解析失败为 null）
  nextCheckDate: string | null // 下次校验日（缺失时按周期倒推）
  nextCheckEstimated: boolean // 下次校验日是否为倒推值
  daysUntilDue: number | null // 距到期天数，负数表示已超期
  actionCount: number // 动作次数（解析后，无法解析按 0）
  leadDays: number // 生效的提前量
  note: string // 判定说明（未建档原因、倒推来源等）
}

const DAY_MS = 24 * 60 * 60 * 1000

// 日期统一按 UTC 零点处理，避免时区把同一天算成两个结论。
function parseDay(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  const text = String(value).trim()
  if (!text) {
    return null
  }
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (match) {
    const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    return Number.isNaN(day) ? null : day
  }
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
}

export function formatDay(day: number): string {
  const date = new Date(day)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${dayOfMonth}`
}

export function todayDay(now: Date = new Date()): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
}

function parseCount(value: unknown): number {
  const count = Number(String(value ?? '').trim())
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

/** 单台保护装置的到期判定：上次校验日、下次校验日、提前量、动作次数都在这里判。 */
export function assessProtection(row: EntryRow, today: number = todayDay()): ProtectionAssessment {
  const leadDays = DUE_SOON_LEAD_DAYS
  const settingNo = String(row['定值单号'] ?? '').trim()
  const last = parseDay(row['上次校验日'])
  const actionCount = parseCount(row['动作次数'])
  const lastCheckDate = last === null ? null : formatDay(last)

  // 定值单号为空：按未建档处理，不参与正常/待校验/即将到期分档。
  if (!settingNo) {
    return {
      tier: '未建档',
      lastCheckDate,
      nextCheckDate: null,
      nextCheckEstimated: false,
      daysUntilDue: null,
      actionCount,
      leadDays,
      note: '定值单号为空，按未建档处理，不参与正常/待校验/即将到期分档',
    }
  }

  // 没有可解析的上次校验日：视为无校验记录，直接待校验。
  if (last === null) {
    return {
      tier: '待校验',
      lastCheckDate,
      nextCheckDate: null,
      nextCheckEstimated: false,
      daysUntilDue: null,
      actionCount,
      leadDays,
      note: '上次校验日缺失或无法解析，按待校验处理',
    }
  }

  // 下次校验日缺失时按 上次校验日+校验周期 倒推；迁移回填过的记录以来源标记为准。
  const parsedNext = parseDay(row['下次校验日'])
  const backfillSource = String(row['下次校验日来源'] ?? '').trim()
  const nextCheckEstimated = parsedNext === null || backfillSource !== ''
  const next = parsedNext ?? last + REVIEW_CYCLE_DAYS * DAY_MS
  const nextCheckDate = formatDay(next)
  const daysUntilDue = Math.round((next - today) / DAY_MS)
  const sourceNote = nextCheckEstimated
    ? backfillSource
      ? `下次校验日来源：${backfillSource}`
      : `下次校验日缺失，按上次校验日+${REVIEW_CYCLE_DAYS}天倒推为 ${nextCheckDate}`
    : ''
  const withSource = (text: string) => (sourceNote ? `${text}；${sourceNote}` : text)

  const base = { lastCheckDate, nextCheckDate, nextCheckEstimated, daysUntilDue, actionCount, leadDays }

  // 动作次数到限：不等日期，直接待校验。
  if (actionCount >= ACTION_COUNT_LIMIT) {
    return {
      ...base,
      tier: '待校验',
      note: withSource(`动作次数 ${actionCount} 次达到 ${ACTION_COUNT_LIMIT} 次上限，需安排校验`),
    }
  }
  // 已超期：待校验。
  if (daysUntilDue < 0) {
    return { ...base, tier: '待校验', note: withSource(`已过下次校验日 ${-daysUntilDue} 天`) }
  }
  // 提前量之内：即将到期。
  if (daysUntilDue <= leadDays) {
    return {
      ...base,
      tier: '即将到期',
      note: withSource(`距下次校验日还有 ${daysUntilDue} 天（提前量 ${leadDays} 天）`),
    }
  }
  return { ...base, tier: '正常', note: withSource(`距下次校验日还有 ${daysUntilDue} 天`) }
}

export function assessProtectionRows(
  rows: EntryRow[],
  today: number = todayDay(),
): Map<number, ProtectionAssessment> {
  return new Map(rows.map((row) => [Number(row.id), assessProtection(row, today)]))
}

export function summarizeProtection(
  rows: EntryRow[],
  today: number = todayDay(),
): Record<ProtectionTier, number> {
  const summary: Record<ProtectionTier, number> = { 正常: 0, 待校验: 0, 即将到期: 0, 未建档: 0 }
  for (const row of rows) {
    summary[assessProtection(row, today).tier] += 1
  }
  return summary
}

/** 动作提示用的完整描述。 */
export function describeAssessment(assessment: ProtectionAssessment): string {
  switch (assessment.tier) {
    case '未建档':
      return '未建档（定值单号为空，按未建档处理）'
    case '待校验':
      if (assessment.daysUntilDue !== null && assessment.daysUntilDue < 0) {
        return `待校验（已过下次校验日 ${-assessment.daysUntilDue} 天）`
      }
      if (assessment.actionCount >= ACTION_COUNT_LIMIT) {
        return `待校验（动作次数 ${assessment.actionCount} 次到限）`
      }
      return '待校验（无有效校验记录）'
    case '即将到期':
      return `即将到期（距下次校验日 ${assessment.nextCheckDate} 还有 ${assessment.daysUntilDue} 天）`
    case '正常':
      return `正常（距下次校验日还有 ${assessment.daysUntilDue} 天）`
  }
}

/** 列表单元格用的短标签。 */
export function assessmentBadge(assessment: ProtectionAssessment): string {
  if (
    assessment.tier === '待校验' &&
    assessment.daysUntilDue !== null &&
    assessment.daysUntilDue < 0
  ) {
    return `待校验（超期 ${-assessment.daysUntilDue} 天）`
  }
  if (
    (assessment.tier === '即将到期' || assessment.tier === '正常') &&
    assessment.daysUntilDue !== null
  ) {
    return `${assessment.tier}（${assessment.daysUntilDue} 天）`
  }
  return assessment.tier
}

const TIER_ORDER: Record<ProtectionTier, number> = { 待校验: 0, 即将到期: 1, 正常: 2, 未建档: 3 }

/** 另存排序：按统一判定排，越紧急越靠前；同档按距到期天数升序，再按编号稳定。 */
export function sortProtectionByExpiry(rows: EntryRow[], today: number = todayDay()): EntryRow[] {
  const assessed = assessProtectionRows(rows, today)
  return [...rows].sort((a, b) => {
    const left = assessed.get(Number(a.id))
    const right = assessed.get(Number(b.id))
    if (!left || !right) {
      return Number(a.id) - Number(b.id)
    }
    const tierDiff = TIER_ORDER[left.tier] - TIER_ORDER[right.tier]
    if (tierDiff !== 0) {
      return tierDiff
    }
    const leftDays = left.daysUntilDue ?? Number.MAX_SAFE_INTEGER
    const rightDays = right.daysUntilDue ?? Number.MAX_SAFE_INTEGER
    if (leftDays !== rightDays) {
      return leftDays - rightDays
    }
    return Number(a.id) - Number(b.id)
  })
}

export type ProtectionMigration = {
  rows: EntryRow[]
  changed: boolean
  duplicatesRemoved: number
  backfilled: number
}

/**
 * 存量装置迁移，幂等，反复初始化不会多出重复装置：
 * 1) 同一装置编号只保留一笔，按最近一次生效（上次校验日最新）的那一版覆盖，其余按重复处理；
 * 2) 缺下次校验日的按上次校验日+校验周期倒推回填，并写明来源；已有结论与既有等级一律不动。
 */
export function migrateProtectionRows(rows: EntryRow[]): ProtectionMigration {
  const byDevice = new Map<string, EntryRow>()
  const order: string[] = []
  let duplicatesRemoved = 0
  for (const row of rows) {
    const code = String(row['装置编号'] ?? '').trim()
    // 无编号的记录无法判重，按独立装置保留。
    const key = code || `#id:${row.id}`
    const existing = byDevice.get(key)
    if (!existing) {
      byDevice.set(key, row)
      order.push(key)
      continue
    }
    duplicatesRemoved += 1
    const existingLast = parseDay(existing['上次校验日'])
    const currentLast = parseDay(row['上次校验日'])
    // 最近一次生效的覆盖旧的；校验日相同或都缺失时保留先到的，保证幂等。
    if (currentLast !== null && (existingLast === null || currentLast > existingLast)) {
      byDevice.set(key, row)
    }
  }

  let backfilled = 0
  const migrated = order.map((key) => {
    const row = byDevice.get(key) as EntryRow
    if (parseDay(row['下次校验日']) !== null) {
      return row
    }
    const last = parseDay(row['上次校验日'])
    if (last === null) {
      return row
    }
    backfilled += 1
    return {
      ...row,
      下次校验日: formatDay(last + REVIEW_CYCLE_DAYS * DAY_MS),
      下次校验日来源: `按上次校验日+${REVIEW_CYCLE_DAYS}天倒推`,
    }
  })

  return {
    rows: migrated,
    changed: duplicatesRemoved > 0 || backfilled > 0,
    duplicatesRemoved,
    backfilled,
  }
}

/** 把到期判定结论转成现场巡视隐患清单条目（缺陷处置台账格式），id 由合并时分配。 */
export function buildProtectionHazards(rows: EntryRow[], today: number = todayDay()): EntryRow[] {
  const hazards: EntryRow[] = []
  for (const row of sortProtectionByExpiry(rows, today)) {
    const assessment = assessProtection(row, today)
    if (assessment.tier !== '待校验' && assessment.tier !== '即将到期') {
      continue
    }
    const code = String(row['装置编号'] ?? '').trim() || `ID${row.id}`
    const parts = [
      `继电保护统一判定：${describeAssessment(assessment)}`,
      `上次校验日 ${assessment.lastCheckDate ?? '无记录'}`,
      `下次校验日 ${assessment.nextCheckDate ?? '未知'}`,
      `动作次数 ${assessment.actionCount} 次`,
      `提前量 ${assessment.leadDays} 天`,
    ]
    if (assessment.nextCheckEstimated) {
      parts.push('下次校验日为倒推值')
    }
    parts.push('来源：继电保护台账')
    hazards.push({
      id: 0,
      status: '待处理',
      pending: true,
      abnormal: assessment.tier === '待校验',
      缺陷编号: `${HAZARD_CODE_PREFIX}${code}`,
      设备名称: `保护装置 ${code}（${String(row['保护类型'] ?? '未知类型')}）`,
      缺陷描述: parts.join('；'),
      缺陷等级: assessment.tier === '待校验' ? '严重' : '一般',
      发现日期: formatDay(today),
      处理期限: assessment.nextCheckDate ?? '',
      处理人员: String(row['校验人员'] ?? '').trim() || '待指派',
      缺陷状态: '待处理',
    })
  }
  return hazards
}

export type HazardMerge = {
  rows: EntryRow[]
  written: number
  removed: number
}

/**
 * 隐患清单回写：按缺陷编号整批覆盖——同一编号只保留最近一次生效的判定，
 * 不与旧结果叠加；已恢复正常的装置对应的旧隐患条目移除；非保护来源的缺陷记录不动。
 */
export function mergeProtectionHazards(existing: EntryRow[], hazards: EntryRow[]): HazardMerge {
  const isHazard = (row: EntryRow) =>
    String(row['缺陷编号'] ?? '').startsWith(HAZARD_CODE_PREFIX)
  const kept = existing.filter((row) => !isHazard(row))
  const previous = new Map(
    existing.filter(isHazard).map((row) => [String(row['缺陷编号']), row] as const),
  )
  let nextId = Math.max(0, ...existing.map((row) => Number(row.id) || 0)) + 1
  const seen = new Set<string>()
  const merged: EntryRow[] = []
  for (const hazard of hazards) {
    const code = String(hazard['缺陷编号'])
    // 同一时刻并发/重复写入只保留一笔，其余按重复处理。
    if (seen.has(code)) {
      continue
    }
    seen.add(code)
    const old = previous.get(code)
    previous.delete(code)
    merged.push({ ...hazard, id: old ? old.id : nextId++ })
  }
  return { rows: [...kept, ...merged], written: merged.length, removed: previous.size }
}
