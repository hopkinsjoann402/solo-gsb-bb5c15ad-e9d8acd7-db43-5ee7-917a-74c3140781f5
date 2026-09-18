import assert from 'node:assert'
import {
  computeCoverageIssues,
  coverageKindAt,
  normalizeCoverageTags,
} from '../src/lib/coverage'
import { planTagRename } from '../src/lib/rename'
import type { Annotation } from '../src/types'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

let seq = 0
function ann(
  start: number,
  end: number,
  tags: string[],
  id?: string,
  status: Annotation['status'] = 'bound',
): Annotation {
  seq += 1
  return {
    id: id ?? `a${seq}`,
    quote: '',
    start,
    end,
    note: '',
    tags,
    status,
    createdAt: 0,
    updatedAt: 0,
    contextBefore: '',
    contextAfter: '',
  }
}

// 1. 恰好单层覆盖全文 → 无问题
check('恰好单层覆盖全文：无缺口无重叠', () => {
  const ans = [ann(0, 5, ['甲']), ann(5, 10, ['乙'])]
  assert.deepStrictEqual(computeCoverageIssues(10, ans, ['甲', '乙']), [])
})

// 2. 中间未覆盖 → 一个缺口，范围精确
check('中间未覆盖区域记为缺口', () => {
  const ans = [ann(0, 3, ['甲']), ann(7, 10, ['甲'])]
  const issues = computeCoverageIssues(10, ans, ['甲'])
  assert.deepStrictEqual(issues, [
    { kind: 'gap', start: 3, end: 7, annotationIds: [] },
  ])
})

// 3. 开头与结尾的缺口分别列出，按起点排序
check('开头与结尾缺口分别列出并按起点排序', () => {
  const ans = [ann(2, 5, ['甲'])]
  const issues = computeCoverageIssues(8, ans, ['甲'])
  assert.deepStrictEqual(
    issues.map((i) => [i.kind, i.start, i.end]),
    [
      ['gap', 0, 2],
      ['gap', 5, 8],
    ],
  )
})

// 4. 两条标注相交 → 重叠，参与者按字典序列出
check('两条标注相交记为重叠并列出双方', () => {
  const ans = [ann(0, 6, ['甲'], 'b'), ann(4, 10, ['乙'], 'a')]
  const issues = computeCoverageIssues(10, ans, ['甲', '乙'])
  assert.deepStrictEqual(issues, [
    { kind: 'overlap', start: 4, end: 6, annotationIds: ['a', 'b'] },
  ])
})

// 5. 三层重叠 → 一条重叠含全部三个标注
check('三层重叠合并为一条并列出全部参与者', () => {
  const ans = [
    ann(0, 10, ['甲'], 'x'),
    ann(2, 8, ['乙'], 'y'),
    ann(2, 8, ['甲'], 'z'),
  ]
  const issues = computeCoverageIssues(10, ans, ['甲', '乙'])
  assert.deepStrictEqual(issues, [
    { kind: 'overlap', start: 2, end: 8, annotationIds: ['x', 'y', 'z'] },
  ])
})

// 5b. 嵌套但参与集合逐段不同 → 不合并，逐段列出
check('嵌套重叠参与集合不同则分段列出', () => {
  const ans = [
    ann(0, 10, ['甲'], 'x'),
    ann(2, 8, ['乙'], 'y'),
    ann(4, 6, ['甲'], 'z'),
  ]
  const issues = computeCoverageIssues(10, ans, ['甲', '乙'])
  assert.deepStrictEqual(issues, [
    { kind: 'overlap', start: 2, end: 4, annotationIds: ['x', 'y'] },
    { kind: 'overlap', start: 4, end: 6, annotationIds: ['x', 'y', 'z'] },
    { kind: 'overlap', start: 6, end: 8, annotationIds: ['x', 'y'] },
  ])
})

// 6. 半开区间：端点相接不算重叠也不算缺口
check('半开区间端点相接：不算重叠也不算缺口', () => {
  const ans = [ann(0, 5, ['甲']), ann(5, 10, ['甲'])]
  assert.deepStrictEqual(computeCoverageIssues(10, ans, ['甲']), [])
})

// 7. 待处理标注不参与：其覆盖区域成为缺口
check('待处理标注被忽略，其区域记为缺口', () => {
  const ans = [ann(0, 10, ['甲'], 'x', 'pending')]
  const issues = computeCoverageIssues(10, ans, ['甲'])
  assert.deepStrictEqual(issues, [
    { kind: 'gap', start: 0, end: 10, annotationIds: [] },
  ])
})

// 8. 空区间（end <= start）不参与
check('空区间标注被忽略', () => {
  const ans = [ann(3, 3, ['甲']), ann(0, 10, ['乙'])]
  assert.deepStrictEqual(computeCoverageIssues(10, ans, ['甲', '乙']), [])
})

// 9. 未命中所选标签的标注不参与覆盖
check('未命中所选标签的标注不参与覆盖', () => {
  const ans = [ann(0, 5, ['丙']), ann(5, 10, ['甲'])]
  const issues = computeCoverageIssues(10, ans, ['甲'])
  assert.deepStrictEqual(issues, [
    { kind: 'gap', start: 0, end: 5, annotationIds: [] },
  ])
  // 把「丙」也选入后则完整覆盖
  assert.deepStrictEqual(computeCoverageIssues(10, ans, ['甲', '丙']), [])
})

// 10. 命中多个所选标签的标注只算一层覆盖
check('一条标注命中多个所选标签仍只算一层', () => {
  const ans = [ann(0, 10, ['甲', '乙'])]
  assert.deepStrictEqual(computeCoverageIssues(10, ans, ['甲', '乙']), [])
})

// 11. 未选择标签 / 空文本 → 不审计
check('未选择标签或空文本时不产生问题', () => {
  assert.deepStrictEqual(computeCoverageIssues(10, [ann(0, 5, ['甲'])], []), [])
  assert.deepStrictEqual(computeCoverageIssues(0, [], ['甲']), [])
})

// 12. 相邻重叠的参与集合不同 → 不合并，各自独立列出
check('相邻重叠参与集合不同则不合并', () => {
  const ans = [ann(0, 10, ['甲'], 'a'), ann(0, 5, ['乙'], 'b'), ann(5, 10, ['丙'], 'c')]
  const issues = computeCoverageIssues(10, ans, ['甲', '乙', '丙'])
  assert.deepStrictEqual(issues, [
    { kind: 'overlap', start: 0, end: 5, annotationIds: ['a', 'b'] },
    { kind: 'overlap', start: 5, end: 10, annotationIds: ['a', 'c'] },
  ])
})

// 13. 完全相同区间的多条标注 → 一条重叠
check('完全相同区间的多条标注合并为一条重叠', () => {
  const ans = [ann(2, 5, ['甲'], 'x'), ann(2, 5, ['乙'], 'y')]
  const issues = computeCoverageIssues(8, ans, ['甲', '乙'])
  assert.deepStrictEqual(issues, [
    { kind: 'gap', start: 0, end: 2, annotationIds: [] },
    { kind: 'overlap', start: 2, end: 5, annotationIds: ['x', 'y'] },
    { kind: 'gap', start: 5, end: 8, annotationIds: [] },
  ])
})

// 14. 越界区间截断到全文范围后参与
check('越界区间截断后参与扫描', () => {
  const ans = [ann(-3, 5, ['甲'], 'x'), ann(5, 99, ['乙'], 'y')]
  assert.deepStrictEqual(computeCoverageIssues(10, ans, ['甲', '乙']), [])
  // 截断后仍重叠的情形
  const ans2 = [ann(-3, 6, ['甲'], 'x'), ann(4, 99, ['乙'], 'y')]
  assert.deepStrictEqual(computeCoverageIssues(10, ans2, ['甲', '乙']), [
    { kind: 'overlap', start: 4, end: 6, annotationIds: ['x', 'y'] },
  ])
})

// 15. 缺口与重叠可同时存在，结果按起点排序
check('缺口与重叠混合时按起点排序', () => {
  const ans = [ann(2, 6, ['甲'], 'x'), ann(4, 8, ['乙'], 'y')]
  const issues = computeCoverageIssues(10, ans, ['甲', '乙'])
  assert.deepStrictEqual(
    issues.map((i) => [i.kind, i.start, i.end]),
    [
      ['gap', 0, 2],
      ['overlap', 4, 6],
      ['gap', 8, 10],
    ],
  )
})

// 16. normalizeCoverageTags：清洗、去重、非数组容错
check('normalizeCoverageTags：去 #、去空白、去重、容错', () => {
  assert.deepStrictEqual(
    normalizeCoverageTags([' #甲 ', '乙', '甲', '', '  ', '#乙']),
    ['甲', '乙'],
  )
  assert.deepStrictEqual(normalizeCoverageTags(undefined), [])
  assert.deepStrictEqual(normalizeCoverageTags('甲'), [])
  // 非字符串按 String 强转（与 normalizeRules 的清洗口径一致），null 为空被丢弃
  assert.deepStrictEqual(normalizeCoverageTags([1, null, '丙']), ['1', '丙'])
})

// 17. coverageKindAt：段落入区间判定
check('coverageKindAt：判定段所落的问题类型', () => {
  const ranges = [
    { start: 0, end: 2, kind: 'gap' as const },
    { start: 4, end: 6, kind: 'overlap' as const },
  ]
  assert.strictEqual(coverageKindAt(ranges, 0, 2), 'gap')
  assert.strictEqual(coverageKindAt(ranges, 1, 2), 'gap')
  assert.strictEqual(coverageKindAt(ranges, 4, 6), 'overlap')
  assert.strictEqual(coverageKindAt(ranges, 2, 4), null)
  assert.strictEqual(coverageKindAt(ranges, 6, 9), null)
})

// 18. 标签重命名同步替换覆盖审计选择（含去重）
check('标签重命名同步更新覆盖审计标签选择', () => {
  const doc = {
    annotations: [ann(0, 10, ['正面'], 'x')],
    conflictRules: [],
    ignoredConflicts: [],
    coverageTags: ['正面', '重点'],
  }
  const plan = planTagRename(doc, '正面', '褒奖')!
  assert.strictEqual(plan.coverageChanged, true)
  assert.deepStrictEqual(plan.coverageTags, ['褒奖', '重点'])

  // 目标标签已在选择中 → 去重保序
  const plan2 = planTagRename(doc, '正面', '重点')!
  assert.deepStrictEqual(plan2.coverageTags, ['重点'])

  // 未选中源标签 → 原样保留
  const plan3 = planTagRename(
    { ...doc, coverageTags: ['重点'] },
    '正面',
    '褒奖',
  )!
  assert.strictEqual(plan3.coverageChanged, false)
  assert.deepStrictEqual(plan3.coverageTags, ['重点'])
})

console.log(`\n全部 ${passed} 项通过`)
