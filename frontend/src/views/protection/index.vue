<template>
  <section class="page" data-module="protection">
    <header class="page-head">
      <div>
        <h2>继电保护管理</h2>
        <p class="page-desc">维护保护装置，围绕装置编号、保护类型、定值单号、上次校验日做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记保护装置</button>
        <button class="btn" type="button" @click="writeBackHazards">回写隐患清单</button>
        <button class="btn" type="button" @click="exportHazards">导出隐患清单</button>
        <button class="btn" type="button" @click="exportRows">导出继电保护清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>到期判定</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td :title="assessmentNote(row)">{{ assessmentBadgeOf(row) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无继电保护数据，可先登记保护装置</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条继电保护记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  downloadProtectionHazards,
  listEntries,
  listProtectionHazards,
  moduleMeta,
  protectionAssessments,
  protectionSummary,
  runAction as applyAction,
  syncProtectionHazards,
} from '@/api/local-service'
import { assessmentBadge } from '@/data/protection-expiry'
import type { ProtectionAssessment, ProtectionTier } from '@/data/protection-expiry'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('protection')
const columns = ["装置编号", "保护类型", "定值单号", "上次校验日", "下次校验日", "动作次数", "校验人员", "装置状态"]
const actions = ["提交校验", "标记异常", "退出运行"]
const statuses = ["待校验", "正常", "异常", "已退出"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
// 三档（含未建档）统计与逐台判定都来自 data/protection-expiry.ts 那一份实现。
const summary = ref<Record<ProtectionTier, number>>({ 正常: 0, 待校验: 0, 即将到期: 0, 未建档: 0 })
const assessments = ref<Map<number, ProtectionAssessment>>(new Map())

const stats = computed(() => [
  { label: '正常保护装置', value: summary.value['正常'] },
  { label: '待校验装置', value: summary.value['待校验'] },
  { label: '即将到期装置', value: summary.value['即将到期'] },
  { label: '未建档装置', value: summary.value['未建档'] },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function assessmentOf(row: EntryRow): ProtectionAssessment | undefined {
  return assessments.value.get(Number(row.id))
}

function assessmentBadgeOf(row: EntryRow): string {
  const assessment = assessmentOf(row)
  return assessment ? assessmentBadge(assessment) : '—'
}

function assessmentNote(row: EntryRow): string {
  return assessmentOf(row)?.note ?? ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '保护装置登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function writeBackHazards() {
  errorMessage.value = ''
  const result = syncProtectionHazards()
  noticeMessage.value = `已按最近一次判定覆盖隐患清单：回写 ${result.written} 条、移除失效 ${result.removed} 条，缺陷处置页与导出清单同为 ${result.written} 条`
  reload()
}

function exportHazards() {
  errorMessage.value = ''
  const count = listProtectionHazards().length
  downloadProtectionHazards()
  noticeMessage.value = `已导出隐患清单 ${count} 条，与页面条数一致`
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    summary.value = protectionSummary()
    assessments.value = protectionAssessments()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '继电保护列表读取失败'
  }
}

onMounted(reload)
</script>
