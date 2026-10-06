// 服务层端到端验证：用 localStorage 桩在 Node 下跑迁移、动作、另存与导出。
const storage = new Map<string, string>()
;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  },
}

import { listRows, saveRows } from '../src/data/local-store'
import * as svc from '../src/domain/protection/service'
import * as store from '../src/domain/protection/store'

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

// 1. 首次初始化：存量 6 台
svc.ensureProtectionInitialized()
const rows1 = svc.listProtectionRows()
check('存量装置6台', rows1.length, 6)

const byNo = Object.fromEntries(rows1.map((r) => [r['装置编号'], r]))
check('PROT-0001 即将到期', byNo['PROT-0001']['到期等级'], '即将到期')
check('PROT-0002 待校验(逾期)', byNo['PROT-0002']['到期等级'], '待校验')
check('PROT-0003 缺下次日倒推后正常', byNo['PROT-0003']['到期等级'], '正常')
check('PROT-0003 已回填下次校验日', byNo['PROT-0003']['下次校验日'], '2027-08-01')
check('PROT-0004 未建档', byNo['PROT-0004']['到期等级'], '未建档')
check('PROT-0005 已退出仍冻结待校验', byNo['PROT-0005']['到期等级'], '待校验')
check('PROT-0006 正常', byNo['PROT-0006']['到期等级'], '正常')

const stats = svc.protectionStats(rows1)
check('统计卡片[正常,待校验,即将到期]', stats.map((s) => s.value), [2, 1, 1])

// 2. 反复初始化不多装置、不重复台账
svc.ensureProtectionInitialized()
svc.ensureProtectionInitialized()
check('重复初始化仍6台', svc.listProtectionRows().length, 6)
const ledgerAfterInit = store.allLedger()
const ledgerIds = ledgerAfterInit.map((e) => e.id)
check('台账无重复记录', new Set(ledgerIds).size, ledgerIds.length)

// 3. 隐患页面条数 == 导出条数
const hazards = svc.openHazards()
check('在办隐患2条(0001/0002)', hazards.map((h) => h.装置编号).sort(), ['PROT-0001', 'PROT-0002'])
check('隐患导出条数=页面条数', svc.exportHazardsCsv().count, hazards.length)

// 4. 清单导出台数 == 页面条数
const csv = svc.exportProtectionCsv()
check('清单导出行数=页面条数', csv.content.trim().split('\n').length - 1, rows1.length)

// 5. 台账按时间排序、缺项来源写清
const ledgerCsv = svc.exportLedgerCsv()
check('台账导出行数=存储条数', ledgerCsv.count, ledgerAfterInit.length)
const dates = ledgerAfterInit.map((e) => e.上次校验日)
check('台账按上次校验日排序', JSON.stringify(dates), JSON.stringify([...dates].sort()))
check('缺项来源写明倒推', ledgerAfterInit.find((e) => e.装置编号 === 'PROT-0003')!.来源.includes('倒推'), true)

// 6. 同版本另存整版覆盖、不叠加
const v1a = svc.saveSnapshotAs('V1')
check('另存V1成功', v1a.ok, true)
const v1Rows = store.allSnapshots()['V1'].rows.length
const v1b = svc.saveSnapshotAs('V1')
check('同版本覆盖成功', v1b.ok, true)
check('同版本只有一条(不叠加)', Object.keys(store.allSnapshots()).length, 1)
check('覆盖后为整版行数', store.allSnapshots()['V1'].rows.length, v1Rows)
const sortedDevices = store.allSnapshots()['V1'].rows.map((r) => r['装置编号'])
check('另存排序:待校验在前', sortedDevices[0], 'PROT-0005')
check('另存排序:未建档垫底', sortedDevices[sortedDevices.length - 1], 'PROT-0004')
check('另存排序:待校验日期升序', sortedDevices.slice(0, 2), ['PROT-0005', 'PROT-0002'])

// 7. 并发写入同一动作只保留一笔
const target = rows1.find((r) => r['装置编号'] === 'PROT-0001')!
const r1 = svc.runProtectionAction(Number(target.id), '标记异常')
const r2 = svc.runProtectionAction(Number(target.id), '标记异常')
check('并发首笔生效', r1.ok, true)
check('并发重入按重复处理', r2.ok, false)

// 8. 未建档装置禁止动作
const unfiledRow = rows1.find((r) => r['装置编号'] === 'PROT-0004')!
check('未建档动作被拒', svc.runProtectionAction(Number(unfiledRow.id), '提交校验').ok, false)

// 9. 提交校验：重定级、动作基线、追加台账、隐患闭环，且台账与导出同时更新
const pending = svc.listProtectionRows().find((r) => r['装置编号'] === 'PROT-0002')!
const ledgerBefore = store.allLedger().length
const submit = svc.runProtectionAction(Number(pending.id), '提交校验')
check('提交校验成功', submit.ok, true)
const after = svc.listProtectionRows().find((r) => r['装置编号'] === 'PROT-0002')!
check('提交校验后重定级正常', after['到期等级'], '正常')
check('下次校验日=今天+365', after['下次校验日'], '2027-10-06')
check('台账追加1条', store.allLedger().length, ledgerBefore + 1)
check('隐患闭环后只剩0001在办', svc.openHazards().map((h) => h.装置编号), ['PROT-0001'])
check('隐患闭环结论已回写', store.allHazards().find((h) => h.装置编号 === 'PROT-0002')!.处理结论.includes('完成校验'), true)
check('台账与导出同时更新', svc.exportLedgerCsv().count, store.allLedger().length)

// 10. 校验后又动作（次数超基线，基线=提交时的0）→ 立即回到待校验
const prot = listRows('protection')
const idx2 = prot.findIndex((r) => r['装置编号'] === 'PROT-0002')
prot[idx2] = { ...prot[idx2], '动作次数': 2 }
saveRows('protection', prot)
check('动作超基线判待校验', svc.listProtectionRows().find((r) => r['装置编号'] === 'PROT-0002')!['到期等级'], '待校验')

// 11. 退出运行：本装置隐患闭环（0002 因又动作产生的待校验隐患保留）
const exiting = svc.listProtectionRows().find((r) => r['装置编号'] === 'PROT-0001')!
check('退出成功', svc.runProtectionAction(Number(exiting.id), '退出运行').ok, true)
check('退出后仅剩0002在办(动作待校验)', svc.openHazards().map((h) => h.装置编号), ['PROT-0002'])

if (failures > 0) {
  console.error(`\n${failures} 项断言失败`)
  process.exit(1)
}
console.log('\n服务层端到端断言全部通过')
