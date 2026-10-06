<template>
  <section class="page" data-module="patrol-hazard">
    <header class="page-head">
      <div>
        <h2>现场巡视 · 继电保护隐患清单</h2>
        <p class="page-desc">继电保护的待校验、即将到期结论自动回写为本清单隐患，处理结论由装置动作回写。页面条数与导出条数同源。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="reload">刷新清单</button>
        <button class="btn" type="button" @click="exportHazards">导出隐患清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">在办隐患</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待校验隐患</span>
        <strong class="stat-value">{{ pendingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">即将到期隐患</span>
        <strong class="stat-value">{{ soonCount }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ (row as unknown as Record<string, string>)[column] || '—' }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length" class="empty-state">当前没有在办的继电保护隐患</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条在办隐患，导出条数与本页一致</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { exportHazardsCsv, openHazards } from '@/domain/protection/service'
import type { PatrolHazard } from '@/domain/protection/store'

// 隐患清单的列：明细字段与导出表头保持一致。
const columns = ['装置编号', '保护类型', '隐患描述', '到期等级', '发现日期', '最近提示日', '处理状态']

const rows = ref<PatrolHazard[]>([])
const errorMessage = ref('')
const pendingCount = computed(() => rows.value.filter((row) => row.到期等级 === '待校验').length)
const soonCount = computed(() => rows.value.filter((row) => row.到期等级 === '即将到期').length)

function reload() {
  errorMessage.value = ''
  try {
    // 页面与导出都调 openHazards()，条数天然相同。
    rows.value = openHazards()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '隐患清单读取失败'
  }
}

function exportHazards() {
  const { filename, content } = exportHazardsCsv()
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

onMounted(reload)
</script>
