/**
 * 继电保护到期判定 —— 全仓库唯一口径。
 *
 * 列表展示的到期等级、动作里的到期提示、另存归档的排序，都只能调用本文件，
 * 不允许在页面或其它服务里再按上次校验日/下次校验日各自算一遍。
 *
 * 三档边界（只此一份）：
 *   - 到期日当天及更早      → 待校验（含逾期、到期当天、校验后又动作）
 *   - 距到期日 1~SOON_DAYS 天 → 即将到期（提前量只保留这一个）
 *   - 距到期日超过 SOON_DAYS 天 → 正常
 * 定值单号为空视为未建档，不纳入三档，由调用方给出说明。
 */

/** 校验周期：一年一次，下次校验日 = 上次校验日 + 365 天。 */
export const CALIBRATION_INTERVAL_DAYS = 365
/** 提前量：全仓库唯一的一个值。列表、提示、排序共用，不再各写各的。 */
export const SOON_DAYS = 30

export const TIER = {
  NORMAL: '正常',
  PENDING: '待校验',
  SOON: '即将到期',
} as const

export type ProtectionTier = (typeof TIER)[keyof typeof TIER]
export const PROTECTION_TIERS: ProtectionTier[] = [TIER.NORMAL, TIER.PENDING, TIER.SOON]
/** 未建档是三档之外的特例：定值单号为空、没有建立校验档案。 */
export const UNFILED = '未建档'

export type ProtectionVerdict = {
  /** 三档结论；未建档时为 null。 */
  tier: ProtectionTier | null
  /** 未建档（定值单号为空）。 */
  unfiled: boolean
  /**
   * 生效的下次校验日；原台账缺失时按上次校验日 + 周期倒推。
   */
  dueDate: string | null
  /** 下次校验日是否为倒推得到。 */
  derived: boolean
  /** 距下次校验日天数（负数表示已逾期）；无法定时为 null。 */
  daysLeft: number | null
  /** 判定说明：三档边界原因、倒推说明、未建档说明都写在这里。 */
  reason: string
  /** 是否沿用历史判定（等级冻结，未改写）。 */
  frozen: boolean
  /**
   * 冻结等级之外的待办信号：上次校验后又动作过（次数超基线）。
   * 历史等级仍原样保留，但列表/提示/排序统一把它当作待校验展示。
   */
  actionPending: boolean
}

/**
 * 三处调用方实际使用的等级：历史冻结等级保留在 tier 里不改写，
 * 但校验后又动作（actionPending）时，统一按「待校验」展示与排序。
 */
export function effectiveTier(verdict: ProtectionVerdict): ProtectionTier | null {
  if (verdict.unfiled) return null
  return verdict.actionPending ? TIER.PENDING : verdict.tier
}

export type JudgeInput = {
  定值单号?: string | number
  上次校验日?: string | number
  下次校验日?: string | number
  动作次数?: string | number
  /** 上次提交校验时记录的动作次数基线；null/缺省表示存量装置无基线，不按动作次数追溯。 */
  动作次数基线?: number | null
  /** 已冻结的历史判定结论（装置此前已判定过时传入，等级原样沿用）。 */
  frozenTier?: string
  frozenBaseDate?: string
  frozenDueDate?: string
}

type Day = { year: number; month: number; day: number }

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** 只接受 YYYY-MM-DD，避免 new Date 字符串解析在各浏览器下的时差与兼容问题。 */
export function parseDay(value: string | number | undefined | null): Day | null {
  if (value === undefined || value === null) {
    return null
  }
  const text = String(value).trim()
  const match = DAY_PATTERN.exec(text)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return { year, month, day }
}

function toDate(day: Day): Date {
  return new Date(day.year, day.month - 1, day.day)
}

function formatDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayLocal(): string {
  return formatDay(new Date())
}

export function addDays(value: string | Day, days: number): string {
  const base = typeof value === 'string' ? parseDay(value) : value
  if (!base) {
    return ''
  }
  const date = toDate(base)
  date.setDate(date.getDate() + days)
  return formatDay(date)
}

/** from 到 to 相隔的整天数（to - from）。 */
export function diffDays(from: string | Day, to: string | Day): number | null {
  const fromDay = typeof from === 'string' ? parseDay(from) : from
  const toDay = typeof to === 'string' ? parseDay(to) : to
  if (!fromDay || !toDay) {
    return null
  }
  const millis = toDate(toDay).getTime() - toDate(fromDay).getTime()
  return Math.round(millis / 86_400_000)
}

/** 早期台账没有下次校验日：统一按上次校验日 + 一个校验周期倒推。 */
export function deriveNextDate(lastDate: string | Day): string | null {
  const last = typeof lastDate === 'string' ? parseDay(lastDate) : lastDate
  if (!last) {
    return null
  }
  return addDays(last, CALIBRATION_INTERVAL_DAYS)
}

function unfiledVerdict(): ProtectionVerdict {
  return {
    tier: null,
    unfiled: true,
    dueDate: null,
    derived: false,
    daysLeft: null,
    reason: '定值单号为空，按未建档处理：请先补建定值单并补录校验信息',
    frozen: false,
    actionPending: false,
  }
}

function countOf(value: string | number | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

/** 动作次数基线判定：只有提交校验时记录过基线才参与；存量装置无基线，不追溯。 */
function isActionPending(input: JudgeInput): boolean {
  if (input.动作次数基线 === null || input.动作次数基线 === undefined) {
    return false
  }
  return countOf(input.动作次数) > input.动作次数基线
}

/**
 * 到期判定的唯一入口。today 仅为便于核对边界而开放（默认本机当天）。
 * 传入 frozenTier/frozenBaseDate 时原样沿用历史结论，不重新定级；
 * 但校验后又动作（actionPending）是冻结之后发生的新事实，统一提示为待校验。
 */
export function judgeExpiry(input: JudgeInput, today: string = todayLocal()): ProtectionVerdict {
  if (String(input.定值单号 ?? '').trim() === '') {
    return unfiledVerdict()
  }

  // 已判定过的装置：等级冻结不改写，只回算天数与动作待办信号。
  if (input.frozenTier && PROTECTION_TIERS.includes(input.frozenTier as ProtectionTier)) {
    const baseDate = input.frozenBaseDate && parseDay(input.frozenBaseDate) ? input.frozenBaseDate : today
    const dueText =
      (input.frozenDueDate && parseDay(input.frozenDueDate) && input.frozenDueDate) ||
      (parseDay(input.上次校验日) ? deriveNextDate(input.上次校验日 as string) : null)
    const actionPending = isActionPending(input)
    return {
      tier: input.frozenTier as ProtectionTier,
      unfiled: false,
      dueDate: dueText,
      derived: false,
      daysLeft: dueText ? diffDays(today, dueText) : null,
      reason: actionPending
        ? `历史等级冻结为「${input.frozenTier}」未改写；但上次校验后装置又动作，需重新校验，统一按待校验处理`
        : `沿用既有判定（基准日 ${baseDate}），等级保持「${input.frozenTier}」未改写`,
      frozen: true,
      actionPending,
    }
  }

  const last = parseDay(input.上次校验日)
  if (!last) {
    return {
      tier: TIER.PENDING,
      unfiled: false,
      dueDate: null,
      derived: false,
      daysLeft: null,
      reason: '上次校验日缺失或无法识别，按待校验处理，请人工核实后补录',
      frozen: false,
      actionPending: false,
    }
  }

  let dueText = ''
  let derived = false
  const explicit = parseDay(input.下次校验日)
  if (explicit) {
    dueText = formatDay(toDate(explicit))
  } else {
    dueText = addDays(last, CALIBRATION_INTERVAL_DAYS)
    derived = true
  }
  const daysLeft = diffDays(today, dueText) ?? 0
  const suffix = derived
    ? `（原台账缺下次校验日，按上次校验日 + ${CALIBRATION_INTERVAL_DAYS} 天倒推为 ${dueText}）`
    : ''

  // 动作次数：只有存在校验基线（提交校验时记录过）才参与判定，存量装置不追溯。
  if (isActionPending(input)) {
    const baseline = input.动作次数基线 ?? 0
    return {
      tier: TIER.PENDING,
      unfiled: false,
      dueDate: dueText,
      derived,
      daysLeft,
      reason: `上次校验后装置已动作 ${countOf(input.动作次数) - baseline} 次，按待校验处理${suffix}`,
      frozen: false,
      actionPending: true,
    }
  }

  if (daysLeft <= 0) {
    return {
      tier: TIER.PENDING,
      unfiled: false,
      dueDate: dueText,
      derived,
      daysLeft,
      reason:
        daysLeft === 0
          ? `今天（${dueText}）即为到期校验日，按待校验处理${suffix}`
          : `校验已逾期 ${-daysLeft} 天（下次校验日 ${dueText}），按待校验处理${suffix}`,
      frozen: false,
      actionPending: false,
    }
  }
  if (daysLeft <= SOON_DAYS) {
    return {
      tier: TIER.SOON,
      unfiled: false,
      dueDate: dueText,
      derived,
      daysLeft,
      reason: `距下次校验还有 ${daysLeft} 天（提前 ${SOON_DAYS} 天提示，到期日 ${dueText}）${suffix}`,
      frozen: false,
      actionPending: false,
    }
  }
  return {
    tier: TIER.NORMAL,
    unfiled: false,
    dueDate: dueText,
    derived,
    daysLeft,
    reason: `距下次校验还有 ${daysLeft} 天（到期日 ${dueText}），状态正常${suffix}`,
    frozen: false,
    actionPending: false,
  }
}

/** 装置行 + 旁路冻结结论 → 判定结果。三个调用方都走这里。 */
export function judgeRow(
  row: Record<string, unknown>,
  meta?: {
    到期等级?: string
    判定基准日?: string
    判定到期日?: string | null
    动作次数基线?: number | null
  } | null,
  today: string = todayLocal(),
): ProtectionVerdict {
  return judgeExpiry(
    {
      定值单号: row['定值单号'] as string | number | undefined,
      上次校验日: row['上次校验日'] as string | number | undefined,
      下次校验日: row['下次校验日'] as string | number | undefined,
      动作次数: row['动作次数'] as string | number | undefined,
      动作次数基线: meta?.动作次数基线 ?? null,
      frozenTier: meta?.到期等级,
      frozenBaseDate: meta?.判定基准日,
      frozenDueDate: meta?.判定到期日 ?? undefined,
    },
    today,
  )
}

/** 另存归档/隐患清单的统一排序键：待校验在前，其次即将到期，再次正常，未建档垫底；同档按到期日升序。 */
export function rankTier(verdict: ProtectionVerdict): number {
  const tier = effectiveTier(verdict)
  if (tier === TIER.PENDING) return 0
  if (tier === TIER.SOON) return 1
  if (tier === TIER.NORMAL) return 2
  return 3
}

type DueSortable = { verdict: ProtectionVerdict; deviceNo?: string | number }

export function compareByDue(a: DueSortable, b: DueSortable): number {
  const rankDiff = rankTier(a.verdict) - rankTier(b.verdict)
  if (rankDiff !== 0) {
    return rankDiff
  }
  // 同档（含都无法定时）按到期日早到晚；倒推与明确记录的到期日同等参与排序。
  const dueKey = (date: string | null): number =>
    date ? Number(date.replace(/-/g, '')) : Number.MAX_SAFE_INTEGER
  const aTime = dueKey(a.verdict.dueDate)
  const bTime = dueKey(b.verdict.dueDate)
  if (aTime !== bTime) {
    return aTime - bTime
  }
  return String(a.deviceNo ?? '').localeCompare(String(b.deviceNo ?? ''))
}

/** 到期等级的展示文案：未建档单独成档，其余显示生效三档（冻结后又动作按待校验）。 */
export function tierLabel(verdict: ProtectionVerdict): string {
  const tier = effectiveTier(verdict)
  return tier ?? UNFILED
}
