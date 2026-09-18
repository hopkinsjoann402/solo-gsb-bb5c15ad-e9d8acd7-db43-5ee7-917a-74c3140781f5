// 标签覆盖审计：检查一组标签对应的标注是否共同、且不重叠地覆盖全文
//
// 规则：只统计「已绑定、区间非空、且至少命中一个所选标签」的标注，
// 按半开区间 [start, end) 扫描全文 [0, textLength)：
// - 某段覆盖数为 0 → 缺口（gap）
// - 某段覆盖数大于 1 → 重叠（overlap），记录参与的全部标注
// 相邻且类型与参与标注集合都相同的结果合并为一条；待处理标注与空区间不参与。

import type { Annotation } from '../types'
import { normalizeTag } from './conflicts'

export type CoverageIssueKind = 'gap' | 'overlap'

/** 一条覆盖问题（区间均为半开 [start, end)，按起点升序产出） */
export interface CoverageIssue {
  kind: CoverageIssueKind
  start: number
  end: number
  /** 参与覆盖的标注 ID（字典序）；缺口时为空数组 */
  annotationIds: string[]
}

/** 审计所需的标注最小视图 */
export type CoverageAnnotation = Pick<
  Annotation,
  'id' | 'start' | 'end' | 'status' | 'tags'
>

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/**
 * 扫描全文，返回全部缺口与重叠（按起点升序）。
 * 未选择标签或文本为空时不审计，返回空数组。
 * 区间越界的标注截断到 [0, textLength] 后再参与（防御导入的脏数据）。
 */
export function computeCoverageIssues(
  textLength: number,
  annotations: CoverageAnnotation[],
  selectedTags: string[],
): CoverageIssue[] {
  if (textLength <= 0 || selectedTags.length === 0) return []
  const tagSet = new Set(selectedTags)

  const intervals = annotations
    .filter(
      (a) =>
        a.status === 'bound' && a.end > a.start && a.tags.some((t) => tagSet.has(t)),
    )
    .map((a) => ({
      start: Math.max(0, a.start),
      end: Math.min(textLength, a.end),
      id: a.id,
    }))
    .filter((iv) => iv.end > iv.start)

  // 扫描线：在所有区间端点（含 0 与全文末尾）之间，覆盖集合保持不变
  const points = new Set<number>([0, textLength])
  for (const iv of intervals) {
    points.add(iv.start)
    points.add(iv.end)
  }
  const sorted = [...points].sort((a, b) => a - b)

  const issues: CoverageIssue[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i]
    const end = sorted[i + 1]
    if (end <= start) continue
    const ids = intervals
      .filter((iv) => iv.start <= start && end <= iv.end)
      .map((iv) => iv.id)
      .sort()
    const kind: CoverageIssueKind | null =
      ids.length === 0 ? 'gap' : ids.length > 1 ? 'overlap' : null
    if (!kind) continue
    // 相邻且类型与参与标注集合相同 → 并入上一条
    const last = issues[issues.length - 1]
    if (last && last.kind === kind && last.end === start && sameIds(last.annotationIds, ids)) {
      last.end = end
    } else {
      issues.push({ kind, start, end, annotationIds: ids })
    }
  }
  return issues
}

/** 清洗覆盖审计的标签选择：去空白与前导 #、去空、去重保序；非数组按空处理 */
export function normalizeCoverageTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const x of raw) {
    const t = normalizeTag(String(x ?? ''))
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/**
 * 判断段 [start,end) 落在哪类覆盖问题区间内（区间已按起点排序）。
 * 问题区间由标注端点切出，与渲染分段对齐，因此段要么完整落入、要么完全在外。
 */
export function coverageKindAt(
  ranges: Array<{ start: number; end: number; kind: CoverageIssueKind }>,
  start: number,
  end: number,
): CoverageIssueKind | null {
  for (const r of ranges) {
    if (r.start <= start && end <= r.end) return r.kind
    if (r.start > start) break // ranges 已排序，之后不可能再包含
  }
  return null
}
