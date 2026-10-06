import {
  CALIBRATION_INTERVAL_DAYS,
  SOON_DAYS,
  TIER,
  addDays,
  compareByDue,
  effectiveTier,
  judgeExpiry,
  judgeRow,
} from '../src/domain/protection/expiry'

const TODAY = '2026-10-06'
let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures++
    console.error(`FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
  } else {
    console.log(`ok   ${name}`)
  }
}

// 三档边界只此一份：到期日当天=待校验，前1~30天=即将到期，31天及以上=正常
const due = (offset: number) => addDays(TODAY, offset)
check('当天到期 → 待校验', judgeExpiry({ 定值单号: 'DZ-1', 上次校验日: addDays(due(0), -CALIBRATION_INTERVAL_DAYS), 下次校验日: due(0) }, TODAY).tier, TIER.PENDING)
check('逾期1天 → 待校验', judgeExpiry({ 定值单号: 'DZ-1', 上次校验日: '2025-09-01', 下次校验日: due(-1) }, TODAY).tier, TIER.PENDING)
check('提前1天 → 即将到期', judgeExpiry({ 定值单号: 'DZ-1', 上次校验日: '2025-10-07', 下次校验日: due(1) }, TODAY).tier, TIER.SOON)
check('提前30天 → 即将到期（含边界）', judgeExpiry({ 定值单号: 'DZ-1', 上次校验日: '2025-11-05', 下次校验日: due(SOON_DAYS) }, TODAY).tier, TIER.SOON)
check('提前31天 → 正常', judgeExpiry({ 定值单号: 'DZ-1', 上次校验日: '2025-11-06', 下次校验日: due(SOON_DAYS + 1) }, TODAY).tier, TIER.NORMAL)

// 定值单号为空 → 未建档
const unfiled = judgeExpiry({ 定值单号: '', 上次校验日: '2026-01-01' }, TODAY)
check('空定值单号 → 未建档', { tier: unfiled.tier, unfiled: unfiled.unfiled }, { tier: null, unfiled: true })

// 缺下次校验日 → 按上次校验日 + 365 倒推
const derived = judgeExpiry({ 定值单号: 'DZ-2', 上次校验日: '2025-09-15' }, TODAY)
check('缺下次校验日倒推日期', derived.dueDate, '2026-09-15')
check('倒推后逾期 → 待校验', derived.tier, TIER.PENDING)
check('倒推标记 derived=true', derived.derived, true)

// 动作次数：超过基线 → 待校验；未超按日期
check('动作超基线 → 待校验', judgeExpiry({ 定值单号: 'DZ-3', 上次校验日: '2026-08-01', 下次校验日: due(200), 动作次数: 2, 动作次数基线: 1 }, TODAY).tier, TIER.PENDING)
check('动作未超基线 → 按日期正常', judgeExpiry({ 定值单号: 'DZ-3', 上次校验日: '2026-08-01', 下次校验日: due(200), 动作次数: 1, 动作次数基线: 1 }, TODAY).tier, TIER.NORMAL)
check('存量无基线不追溯动作', judgeExpiry({ 定值单号: 'DZ-3', 上次校验日: '2026-08-01', 下次校验日: due(200), 动作次数: 9 }, TODAY).tier, TIER.NORMAL)

// 已判定过 → 等级冻结不改写，即使日期已变化
const frozen = judgeExpiry({ 定值单号: 'DZ-4', 上次校验日: '2025-01-01', frozenTier: TIER.NORMAL, frozenBaseDate: '2026-09-01', frozenDueDate: due(200) }, TODAY)
check('冻结等级保持正常', frozen.tier, TIER.NORMAL)
check('冻结标记 frozen=true', frozen.frozen, true)

// 冻结后又动作：历史等级不改写，但生效口径统一按待校验
const frozenAction = judgeExpiry({ 定值单号: 'DZ-4', 上次校验日: '2026-09-01', 下次校验日: due(200), 动作次数: 3, 动作次数基线: 1, frozenTier: TIER.NORMAL, frozenBaseDate: '2026-09-01', frozenDueDate: due(200) }, TODAY)
check('冻结后又动作:历史等级仍正常', frozenAction.tier, TIER.NORMAL)
check('冻结后又动作:生效口径待校验', effectiveTier(frozenAction), TIER.PENDING)
check('冻结后又动作:actionPending=true', frozenAction.actionPending, true)

// 无效上次校验日 → 待校验（人工核实）
check('无效日期 → 待校验', judgeExpiry({ 定值单号: 'DZ-5', 上次校验日: '样例文本' }, TODAY).tier, TIER.PENDING)

// judgeRow 与 judgeExpiry 同口径
check('judgeRow 未建档', judgeRow({ 定值单号: '', 上次校验日: '2026-01-01' }, null, TODAY).unfiled, true)

// 排序：待校验 > 即将到期 > 正常 > 未建档；同档按到期日
const mk = (tier: string | null, date: string | null, no: string) =>
  ({ verdict: { tier, unfiled: tier === null, dueDate: date, derived: false, daysLeft: 0, reason: '', frozen: false, actionPending: false }, deviceNo: no })
const sorted = [
  mk(TIER.NORMAL, due(100), 'N'),
  mk(null, null, 'U'),
  mk(TIER.PENDING, due(-5), 'P2'),
  mk(TIER.SOON, due(10), 'S2'),
  mk(TIER.SOON, due(3), 'S1'),
  mk(TIER.PENDING, due(-20), 'P1'),
].sort(compareByDue).map((x) => x.deviceNo)
check('统一排序顺序', sorted, ['P1', 'P2', 'S1', 'S2', 'N', 'U'])

if (failures > 0) {
  console.error(`\n${failures} 项断言失败`)
  process.exit(1)
}
console.log('\n全部断言通过')
