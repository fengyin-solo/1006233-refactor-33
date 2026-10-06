import type { ProtectionTier } from './expiry'
import type { EntryRow } from '@/data/types'

/**
 * 继电保护的旁路持久化。
 *
 * 装置原表（EntryRow 那 8 个字段）在收拢后不增不删，保证另存归档的列顺序与字段不动；
 * 到期结论、历史校验记录、现场巡视隐患、另存版本都放这里。
 * 每个键各存各的，同一份 localStorage，读写都带合并，旧版本缺键时自然补空。
 */

export const KEY_META = 'hydropower-plant-om:protection-meta'
export const KEY_LEDGER = 'hydropower-plant-om:protection-ledger'
export const KEY_HAZARD = 'hydropower-plant-om:protection-hazard'
export const KEY_SNAPSHOT = 'hydropower-plant-om:protection-snapshot'

/** 装置的冻结判定：等级一旦落库，只有「提交校验」才会重新判定。 */
export type ProtectionDeviceMeta = {
  装置编号: string
  到期等级: ProtectionTier
  判定到期日: string | null
  判定基准日: string
  下次校验日倒推: boolean
  判定说明: string
  动作次数基线: number | null
  更新时间: string
}

/** 历史校验记录：按上次校验日保留原结论，只追加、不改写。 */
export type ProtectionLedgerEntry = {
  id: number
  装置编号: string
  上次校验日: string
  下次校验日: string | null
  到期等级: ProtectionTier | null
  结论: string
  动作次数: number
  来源: string
  记录时间: string
}

/** 现场巡视隐患清单：一台装置至多一条在办隐患，处理结论由保护动作回写。 */
export type PatrolHazard = {
  id: number
  装置编号: string
  保护类型: string
  隐患描述: string
  到期等级: ProtectionTier | null
  发现日期: string
  最近提示日: string
  处理状态: string
  处理结论: string
  处理时间: string
}

/** 另存归档版本：同一版本整版覆盖（取最近一次生效），不把两次结果叠加。 */
export type ProtectionSnapshot = {
  版本号: string
  生成时间: string
  rows: EntryRow[]
}

function readKey<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeKey<T>(key: string, value: T): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

const metaCache: Map<string, Record<string, ProtectionDeviceMeta>> = new Map()

function metaTable(): Record<string, ProtectionDeviceMeta> {
  const table = readKey<Record<string, ProtectionDeviceMeta>>(KEY_META, {})
  metaCache.set(KEY_META, table)
  return table
}

export function allProtectionMeta(): Record<string, ProtectionDeviceMeta> {
  return metaCache.get(KEY_META) ?? metaTable()
}

export function protectionMetaOf(deviceNo: string): ProtectionDeviceMeta | null {
  return allProtectionMeta()[deviceNo] ?? null
}

export function saveProtectionMeta(table: Record<string, ProtectionDeviceMeta>): void {
  metaCache.set(KEY_META, table)
  writeKey(KEY_META, table)
}

export function allLedger(): ProtectionLedgerEntry[] {
  return readKey<ProtectionLedgerEntry[]>(KEY_LEDGER, [])
}

export function saveLedger(entries: ProtectionLedgerEntry[]): void {
  writeKey(KEY_LEDGER, entries)
}

export function allHazards(): PatrolHazard[] {
  return readKey<PatrolHazard[]>(KEY_HAZARD, [])
}

export function saveHazards(entries: PatrolHazard[]): void {
  writeKey(KEY_HAZARD, entries)
}

export function allSnapshots(): Record<string, ProtectionSnapshot> {
  return readKey<Record<string, ProtectionSnapshot>>(KEY_SNAPSHOT, {})
}

export function saveSnapshots(table: Record<string, ProtectionSnapshot>): void {
  writeKey(KEY_SNAPSHOT, table)
}
