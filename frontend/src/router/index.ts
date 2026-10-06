import { createRouter, createWebHistory } from 'vue-router'

import Dashboard from '@/views/Dashboard.vue'
const Station = () => import('@/views/station/index.vue')
const Unit = () => import('@/views/unit/index.vue')
const Governor = () => import('@/views/governor/index.vue')
const Excitation = () => import('@/views/excitation/index.vue')
const Transformer = () => import('@/views/transformer/index.vue')
const Gate = () => import('@/views/gate/index.vue')
const Seepage = () => import('@/views/seepage/index.vue')
const Displacement = () => import('@/views/displacement/index.vue')
const Trashrack = () => import('@/views/trashrack/index.vue')
const Overhaul = () => import('@/views/overhaul/index.vue')
const Bearing = () => import('@/views/bearing/index.vue')
const Cooling = () => import('@/views/cooling/index.vue')
const Hydrology = () => import('@/views/hydrology/index.vue')
const Flood = () => import('@/views/flood/index.vue')
const Generation = () => import('@/views/generation/index.vue')
const Protection = () => import('@/views/protection/index.vue')
const Patrol = () => import('@/views/patrol/index.vue')
const Defect = () => import('@/views/defect/index.vue')
const Crew = () => import('@/views/crew/index.vue')
const Spare = () => import('@/views/spare/index.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: Dashboard },
    { path: '/station', name: 'station', component: Station },
    { path: '/unit', name: 'unit', component: Unit },
    { path: '/governor', name: 'governor', component: Governor },
    { path: '/excitation', name: 'excitation', component: Excitation },
    { path: '/transformer', name: 'transformer', component: Transformer },
    { path: '/gate', name: 'gate', component: Gate },
    { path: '/seepage', name: 'seepage', component: Seepage },
    { path: '/displacement', name: 'displacement', component: Displacement },
    { path: '/trashrack', name: 'trashrack', component: Trashrack },
    { path: '/overhaul', name: 'overhaul', component: Overhaul },
    { path: '/bearing', name: 'bearing', component: Bearing },
    { path: '/cooling', name: 'cooling', component: Cooling },
    { path: '/hydrology', name: 'hydrology', component: Hydrology },
    { path: '/flood', name: 'flood', component: Flood },
    { path: '/generation', name: 'generation', component: Generation },
    { path: '/protection', name: 'protection', component: Protection },
    { path: '/patrol', name: 'patrol', component: Patrol },
    { path: '/defect', name: 'defect', component: Defect },
    { path: '/crew', name: 'crew', component: Crew },
    { path: '/spare', name: 'spare', component: Spare },
  ],
})

export default router
