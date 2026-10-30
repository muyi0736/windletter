import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from 'react'
import { basicSetup } from 'codemirror'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor
} from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import {
  HighlightStyle,
  bracketMatching,
  syntaxHighlighting,
  syntaxTree
} from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { openSearchPanel } from '@codemirror/search'
import { forceLinting, linter, lintGutter, type Diagnostic } from '@codemirror/lint'
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { tags } from '@lezer/highlight'
import type { KubeJsIssue } from '@shared/types'
import {
  KUBEJS_GLOBAL_OBJECTS,
  RECIPE_EVENT_METHODS,
  TAG_EVENT_METHODS,
  findEventGroup
} from '@shared/kubejsKnowledge'

export interface KubeJsDiagnostic extends KubeJsIssue {
  from: number
  to: number
}

export interface KubeJsEditorSelection {
  from: number
  to: number
  startLine: number
  endLine: number
  text: string
  length: number
}

export interface KubeJsEditorHandle {
  focus: () => void
  insert: (text: string) => void
  insertAtCursor: (text: string) => void
  insertId: (id: string) => void
  gotoLine: (line: number, column?: number) => void
  openSearch: () => void
  forget: (path: string) => void
  refresh: () => void
  relint: () => void
  selection: () => KubeJsEditorSelection | null
  replaceRange: (from: number, to: number, text: string) => void
  applyChanges: (changes: { from: number; to: number; text: string }[]) => void
}

interface EditorTabState {
  state: EditorState
  scrollTop: number
}

const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], class: 'kjs-tok-keyword' },
  { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], class: 'kjs-tok-definition' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.labelName],
    class: 'kjs-tok-function'
  },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'kjs-tok-type' },
  { tag: [tags.bool, tags.atom, tags.null], class: 'kjs-tok-bool' },
  { tag: [tags.number, tags.integer, tags.float], class: 'kjs-tok-number' },
  { tag: [tags.string, tags.special(tags.string)], class: 'kjs-tok-string' },
  { tag: [tags.regexp, tags.escape], class: 'kjs-tok-string' },
  { tag: [tags.operator, tags.operatorKeyword, tags.punctuation], class: 'kjs-tok-operator' },
  { tag: [tags.propertyName, tags.attributeName], class: 'kjs-tok-property' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'kjs-tok-comment' },
  { tag: [tags.meta, tags.processingInstruction], class: 'kjs-tok-comment' },
  { tag: tags.invalid, class: 'kjs-tok-invalid' }
])

function readSelection(state: EditorState): KubeJsEditorSelection | null {
  const selection = state.selection.main
  if (selection.empty) return null
  const startLine = state.doc.lineAt(selection.from).number
  const endLine = state.doc.lineAt(selection.to).number
  const text = state.doc.sliceString(selection.from, selection.to)
  return {
    from: selection.from,
    to: selection.to,
    startLine,
    endLine,
    text: text.slice(0, 12000),
    length: selection.to - selection.from
  }
}

function languageFor(path: string): Extension {
  const lower = path.toLowerCase()
  if (lower.endsWith('.js')) return javascript({ jsx: false, typescript: false })
  if (lower.endsWith('.json')) return json()
  return []
}

function collectSyntaxDiagnostics(state: EditorState): KubeJsDiagnostic[] {
  const tree = syntaxTree(state)
  if (!tree || tree.length === 0) return []
  const result: KubeJsDiagnostic[] = []
  const seen = new Set<number>()
  let cursor = tree.cursor()
  do {
    if (!cursor.type.isError) continue
    const from = Math.max(0, Math.min(cursor.from, state.doc.length))
    const to = Math.max(from + 1, Math.min(cursor.to, state.doc.length))
    const line = state.doc.lineAt(from).number
    if (seen.has(line)) continue
    seen.add(line)
    result.push({
      from,
      to: Math.min(to, state.doc.length),
      severity: 'error',
      source: 'syntax',
      code: 'syntax',
      line,
      column: from - state.doc.lineAt(from).from + 1,
      message: '语法错误：此处无法解析，请检查括号、引号或 JSON 结构'
    })
    if (result.length >= 30) break
  } while (cursor.next())
  return result
}

function issuesToDiagnostics(
  state: EditorState,
  issues: KubeJsIssue[]
): { mapped: KubeJsDiagnostic[]; diagnostics: Diagnostic[] } {
  const mapped: KubeJsDiagnostic[] = []
  const diagnostics: Diagnostic[] = []
  for (const issue of issues.slice(0, 100)) {
    const lineNumber = Math.min(Math.max(1, issue.line), state.doc.lines)
    const line = state.doc.line(lineNumber)
    const column = Math.min(Math.max(0, issue.column - 1), line.length)
    const from = Math.min(state.doc.length, line.from + column)
    let to = Math.min(state.doc.length, from + 1)
    if (
      typeof issue.endLine === 'number' &&
      typeof issue.endColumn === 'number' &&
      issue.endLine >= issue.line
    ) {
      const endLineNumber = Math.min(Math.max(1, issue.endLine), state.doc.lines)
      const endLine = state.doc.line(endLineNumber)
      const endColumn = Math.min(Math.max(0, issue.endColumn - 1), endLine.length)
      to = Math.min(state.doc.length, Math.max(from + 1, endLine.from + endColumn))
    }
    const severity: Diagnostic['severity'] =
      issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'
    const mappedIssue: KubeJsDiagnostic = {
      ...issue,
      from,
      to,
      line: lineNumber,
      column: column + 1
    }
    mapped.push(mappedIssue)
    diagnostics.push({
      from,
      to,
      severity,
      message: issue.message,
      source: issue.source
    })
  }
  return { mapped, diagnostics }
}

function editorTheme(): Extension {
  const dark = document.documentElement.dataset.theme === 'dark'
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        backgroundColor: 'transparent',
        color: 'var(--text)'
      },
      '.cm-scroller': {
        fontFamily: 'var(--font-mono)',
        lineHeight: '1.7',
        overflow: 'auto'
      },
      '.cm-content': {
        padding: '10px 0 28px',
        caretColor: 'var(--accent)'
      },
      '.cm-line': { padding: '0 14px 0 6px' },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: 'var(--text-3)',
        border: 'none',
        paddingLeft: '4px'
      },
      '.cm-gutterElement': { padding: '0 8px 0 10px' },
      '.cm-activeLine': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 5%, transparent)'
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--text-2)'
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        // CodeMirror 默认的 focused 选择层规则优先级更高；主题切换后尤其明显。
        backgroundColor: 'var(--selection) !important'
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
      '.cm-panels': {
        backgroundColor: 'var(--surface-2)',
        color: 'var(--text)'
      },
      '.cm-panel.cm-search': {
        padding: '6px 8px',
        fontSize: '10px'
      },
      '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
        fontSize: '10px'
      },
      '.cm-panel.cm-search input': {
        border: '1px solid var(--border)',
        borderRadius: '5px',
        backgroundColor: 'var(--surface)',
        color: 'var(--text)',
        outline: 'none'
      },
      '.cm-panel.cm-search button': {
        border: '1px solid var(--border)',
        borderRadius: '5px',
        backgroundColor: 'var(--surface)',
        color: 'var(--text-2)',
        cursor: 'pointer'
      },
      '.cm-searchMatch': {
        backgroundColor: 'var(--accent-soft-2)',
        outline: '1px solid var(--accent-border)'
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'var(--accent-soft)'
      },
      '.cm-tooltip': {
        border: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
        color: 'var(--text)'
      },
      '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer' }
    },
    { dark }
  )
}

export const KubeJsCodeEditor = forwardRef<
  KubeJsEditorHandle,
  {
    path: string
    instanceId: string
    value: string
    active: boolean
    wrap: boolean
    fontSize: number
    readOnly?: boolean
    onChange: (value: string) => void
    onCursor: (line: number, column: number) => void
    onSelection: (selection: KubeJsEditorSelection | null) => void
    onDiagnostics: (
      path: string,
      diagnostics: KubeJsDiagnostic[],
      indexReady: boolean
    ) => void
    onSave: () => void
    onSaveAll: () => void
    onClose: () => void
    onCycleTab: (direction: 1 | -1) => void
  }
>(function KubeJsCodeEditor(
  {
    path,
    instanceId,
    value,
    active,
    wrap,
    fontSize,
    readOnly = false,
    onChange,
    onCursor,
    onSelection,
    onDiagnostics,
    onSave,
    onSaveAll,
    onClose,
    onCycleTab
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const statesRef = useRef(new Map<string, EditorTabState>())
  const currentPathRef = useRef(path)
  const instanceIdRef = useRef(instanceId)
  instanceIdRef.current = instanceId
  const lastEmittedRef = useRef(value)
  const wrapCompartmentRef = useRef(new Compartment())
  const readOnlyCompartmentRef = useRef(new Compartment())
  const callbacksRef = useRef({
    onChange,
    onCursor,
    onSelection,
    onDiagnostics,
    onSave,
    onSaveAll,
    onClose,
    onCycleTab
  })
  callbacksRef.current = {
    onChange,
    onCursor,
    onSelection,
    onDiagnostics,
    onSave,
    onSaveAll,
    onClose,
    onCycleTab
  }

  const kubeJsCompletion = async (
    context: CompletionContext
  ): Promise<CompletionResult | null> => {
    if (!currentPathRef.current.toLowerCase().endsWith('.js')) return null
    const before = context.state.doc.sliceString(Math.max(0, context.pos - 600), context.pos)
    const stringMatch = before.match(/['"]([^'"\n]*)$/)
    if (stringMatch) {
      const query = stringMatch[1].trim()
      if (!query && !context.explicit) return null
      const tagCall = /event\.(?:add|remove)\s*\(\s*['"][^'"]*$/.test(before)
      const recipeKey = /event\.remove\s*\([\s\S]*?\bid\s*:\s*['"][^'"]*$/.test(before)
      const kubeContext =
        /event\.(?:remove|shaped|shapeless|smelting|blasting|smoking|campfireCooking|stonecutting|smithing|custom)\s*\(|Item\.of\s*\(|Ingredient\.of\s*\(|ServerEvents\.tags/.test(
          before
        )
      const kind = tagCall ? 'tag' : recipeKey ? 'recipe' : kubeContext ? 'item' : null
      if (!kind) {
        if (!context.explicit) return null
      }
      const instanceId = instanceIdRef.current
      if (!instanceId) return null
      try {
        const result = await window.ccl.workshop.kubejsIndexSearch({
          instanceId,
          kind: kind ?? 'item',
          query,
          page: 1,
          pageSize: 8
        })
        const options: Completion[] =
          result.kind === 'item'
            ? result.items.map((item) => ({
                label: item.id,
                detail: item.name,
                info: `${item.modId}${item.block ? ' · 方块' : ''}`,
                type: 'constant'
              }))
            : result.kind === 'recipe'
              ? result.items.map((recipe) => ({
                  label: recipe.id,
                  detail: recipe.output?.name ?? recipe.type,
                  info: recipe.type,
                  type: 'constant'
                }))
              : result.items.map((tag) => ({
                  label: tag.id,
                  detail: `${tag.type} · ${tag.count} 个成员`,
                  type: 'constant'
                }))
        return {
          from: context.pos - query.length,
          options,
          validFor: /^[^'"\n]*$/
        }
      } catch {
        return null
      }
    }

    const word = context.matchBefore(/[A-Za-z_$][\w$]*/)
    const at = context.pos
    const eventMatch = before.match(/event\.([A-Za-z0-9_]*)$/)
    if (eventMatch) {
      const methods = [...new Set([...RECIPE_EVENT_METHODS, ...TAG_EVENT_METHODS])]
      return {
        from: at - eventMatch[1].length,
        options: methods.map((name) => ({
          label: name,
          type: 'method',
          detail: `event.${name}`
        })),
        validFor: /^[A-Za-z0-9_]*$/
      }
    }
    const namespaceMatch = before.match(
      /(ServerEvents|ClientEvents|StartupEvents|PlayerEvents|BlockEvents|ItemEvents|EntityEvents|LevelEvents|NetworkEvents|JEIEvents|REIEvents)\.([A-Za-z0-9_]*)$/
    )
    if (namespaceMatch) {
      const group = findEventGroup(namespaceMatch[1])
      const eventNames = group?.events.map((event) => event.name) ?? []
      return {
        from: at - namespaceMatch[2].length,
        options: eventNames.map((name) => ({
          label: name,
          type: 'method',
          detail: group?.events.find((event) => event.name === name)?.detail ?? namespaceMatch[1]
        })),
        validFor: /^[A-Za-z0-9_]*$/
      }
    }
    if (!word && !context.explicit) return null
    if (word) {
      return {
        from: word.from,
        options: KUBEJS_GLOBAL_OBJECTS.filter((entry) =>
          entry.name.toLowerCase().startsWith(word.text.toLowerCase())
        ).map((entry) => ({ label: entry.name, type: 'class', detail: entry.detail })),
        validFor: /^[A-Za-z_$][\w$]*$/
      }
    }
    return null
  }

  const makeState = (nextPath: string, content: string): EditorState => {
    const base: Extension[] = [
      basicSetup,
      EditorState.languageData.of(() =>
        currentPathRef.current.toLowerCase().endsWith('.js')
          ? [{ autocomplete: kubeJsCompletion }]
          : []
      ),
      EditorState.phrases.of({
        Find: '查找',
        Replace: '替换',
        next: '下一个',
        previous: '上一个',
        all: '全部',
        'match case': '区分大小写',
        regexp: '正则',
        'by word': '全词',
        replace: '替换',
        'replace all': '全部替换',
        close: '关闭',
        'Go to line': '跳转到行',
        go: '跳转',
        'current match': '当前匹配',
        'on line': '行',
        'replaced $ matches': '已替换 $ 处',
        'replaced match on line $': '已替换第 $ 行',
        Diagnostics: '诊断',
        'No diagnostics': '没有诊断'
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const next = update.state.doc.toString()
          lastEmittedRef.current = next
          callbacksRef.current.onChange(next)
        }
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head
          const line = update.state.doc.lineAt(head)
          callbacksRef.current.onCursor(line.number, head - line.from + 1)
          callbacksRef.current.onSelection(readSelection(update.state))
        }
      }),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      bracketMatching(),
      syntaxHighlighting(highlightStyle),
      editorTheme(),
      lintGutter(),
      linter(
        async (view) => {
          const lintPath = currentPathRef.current
          if (!/\.(?:js|json)$/i.test(lintPath)) return []
          const content = view.state.doc.toString()
          const instanceId = instanceIdRef.current
          if (!instanceId) {
            if (currentPathRef.current !== lintPath) return []
            const fallback = collectSyntaxDiagnostics(view.state)
            queueMicrotask(() =>
              callbacksRef.current.onDiagnostics(lintPath, fallback, false)
            )
            return fallback
          }
          try {
            const result = await window.ccl.workshop.kubejsLint({
              instanceId,
              path: lintPath,
              content
            })
            if (
              view.state.doc.toString() !== content ||
              currentPathRef.current !== lintPath
            ) {
              return []
            }
            const { mapped, diagnostics } = issuesToDiagnostics(view.state, result.issues)
            queueMicrotask(() => {
              callbacksRef.current.onDiagnostics(lintPath, mapped, result.indexReady)
            })
            return diagnostics
          } catch {
            if (currentPathRef.current !== lintPath) return []
            const fallback = collectSyntaxDiagnostics(view.state)
            queueMicrotask(() =>
              callbacksRef.current.onDiagnostics(lintPath, fallback, false)
            )
            return fallback
          }
        },
        { delay: 650 }
      ),
      wrapCompartmentRef.current.of(wrap ? EditorView.lineWrapping : []),
      readOnlyCompartmentRef.current.of(
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []
      ),
      keymap.of([
        {
          key: 'Mod-Shift-s',
          preventDefault: true,
          run: () => {
            callbacksRef.current.onSaveAll()
            return true
          }
        },
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            callbacksRef.current.onSave()
            return true
          }
        },
        {
          key: 'Mod-w',
          preventDefault: true,
          run: () => {
            callbacksRef.current.onClose()
            return true
          }
        },
        {
          key: 'Mod-Tab',
          preventDefault: true,
          run: () => {
            callbacksRef.current.onCycleTab(1)
            return true
          }
        },
        {
          key: 'Mod-Shift-Tab',
          preventDefault: true,
          run: () => {
            callbacksRef.current.onCycleTab(-1)
            return true
          }
        },
        {
          key: 'Mod-g',
          preventDefault: true,
          run: (view) => {
            const current = view.state.doc.lineAt(view.state.selection.main.head).number
            const answer = window.prompt('跳转到行号', String(current))
            if (!answer) return true
            const line = Number.parseInt(answer, 10)
            if (!Number.isFinite(line)) return true
            const target = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
            view.dispatch({
              selection: { anchor: target.from },
              effects: EditorView.scrollIntoView(target.from, { y: 'center' })
            })
            view.focus()
            return true
          }
        },
        indentWithTab
      ]),
      languageFor(nextPath)
    ]
    return EditorState.create({ doc: content, extensions: base })
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const state = makeState(path, value)
    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    statesRef.current.set(path, { state, scrollTop: 0 })
    currentPathRef.current = path
    lastEmittedRef.current = value
    if (active) view.focus()
    window.setTimeout(() => {
      if (viewRef.current) forceLinting(viewRef.current)
    }, 80)
    return () => {
      view.destroy()
      viewRef.current = null
      statesRef.current.clear()
    }
    // The editor is created once; path/content updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const previousPath = currentPathRef.current
    if (previousPath && previousPath !== path) {
      statesRef.current.set(previousPath, {
        state: view.state,
        scrollTop: view.scrollDOM.scrollTop
      })
    }
    let entry = statesRef.current.get(path)
    if (!entry) {
      const state = makeState(path, value)
      entry = { state, scrollTop: 0 }
      statesRef.current.set(path, entry)
      view.setState(state)
    } else {
      if (entry.state !== view.state) view.setState(entry.state)
      const current = view.state.doc.toString()
      if (current !== value) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value }
        })
      }
    }
    currentPathRef.current = path
    lastEmittedRef.current = value
    const scrollTop = entry.scrollTop
    requestAnimationFrame(() => {
      view.requestMeasure()
      if (scrollTop > 0) view.scrollDOM.scrollTop = scrollTop
      if (active) view.focus()
      window.setTimeout(() => {
        if (viewRef.current) forceLinting(viewRef.current)
      }, 80)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    const view = viewRef.current
    if (!view || currentPathRef.current !== path) return
    const current = view.state.doc.toString()
    if (current !== value && value !== lastEmittedRef.current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
      lastEmittedRef.current = value
    }
  }, [value, path])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: wrapCompartmentRef.current.reconfigure(
        wrap ? EditorView.lineWrapping : []
      )
    })
    view.requestMeasure()
  }, [wrap])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []
      )
    })
  }, [readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !active) return
    requestAnimationFrame(() => {
      view.requestMeasure()
      view.focus()
      window.setTimeout(() => {
        if (viewRef.current) forceLinting(viewRef.current)
      }, 80)
    })
  }, [active])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const observer = new ResizeObserver(() => view.requestMeasure())
    if (hostRef.current) observer.observe(hostRef.current)
    return () => observer.disconnect()
  }, [])

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    insert: (text: string) => {
      const view = viewRef.current
      if (!view) return
      view.dispatch(view.state.replaceSelection(text))
      view.focus()
    },
    insertAtCursor: (text: string) => {
      const view = viewRef.current
      if (!view) return
      const position = view.state.selection.main.head
      view.dispatch({
        changes: { from: position, insert: text },
        selection: { anchor: position + text.length },
        effects: EditorView.scrollIntoView(position, { y: 'center' })
      })
      view.focus()
    },
    insertId: (id: string) => {
      const view = viewRef.current
      if (!view) return
      const selection = view.state.selection.main
      const doc = view.state.doc
      const before = selection.from > 0 ? doc.sliceString(selection.from - 1, selection.from) : ''
      const after =
        selection.to < doc.length ? doc.sliceString(selection.to, selection.to + 1) : ''
      const quoted =
        (before === "'" || before === '"') && (after === before || after === '')
      const text = quoted ? id : `'${id}'`
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: { anchor: selection.from + text.length }
      })
      view.focus()
    },
    gotoLine: (line: number, column?: number) => {
      const view = viewRef.current
      if (!view) return
      const target = view.state.doc.line(
        Math.min(Math.max(1, line), view.state.doc.lines)
      )
      const offset =
        typeof column === 'number' && Number.isFinite(column)
          ? Math.min(Math.max(0, Math.round(column) - 1), target.length)
          : 0
      const position = target.from + offset
      view.dispatch({
        selection: { anchor: position },
        effects: EditorView.scrollIntoView(position, { y: 'center' })
      })
      view.focus()
    },
    openSearch: () => {
      const view = viewRef.current
      if (view) openSearchPanel(view)
    },
    forget: (targetPath: string) => {
      statesRef.current.delete(targetPath)
    },
    refresh: () => viewRef.current?.requestMeasure(),
    relint: () => {
      if (viewRef.current) forceLinting(viewRef.current)
    },
    selection: () => {
      const view = viewRef.current
      return view ? readSelection(view.state) : null
    },
    replaceRange: (from: number, to: number, text: string) => {
      const view = viewRef.current
      if (!view) return
      const start = Math.min(Math.max(0, from), view.state.doc.length)
      const end = Math.min(Math.max(start, to), view.state.doc.length)
      view.dispatch({
        changes: { from: start, to: end, insert: text },
        selection: { anchor: start + text.length },
        effects: EditorView.scrollIntoView(start, { y: 'center' })
      })
      view.focus()
    },
    applyChanges: (changes: { from: number; to: number; text: string }[]) => {
      const view = viewRef.current
      if (!view) return
      const length = view.state.doc.length
      const sorted = [...changes]
        .map((change) => ({
          from: Math.min(Math.max(0, change.from), length),
          to: Math.min(Math.max(0, change.to), length),
          text: change.text
        }))
        .filter((change) => change.to >= change.from)
        .sort((left, right) => left.from - right.from || left.to - right.to)
      const safe: { from: number; to: number; text: string }[] = []
      let lastTo = -1
      for (const change of sorted) {
        if (change.from < lastTo) continue
        safe.push(change)
        lastTo = change.to
      }
      if (safe.length === 0) return
      const last = safe[safe.length - 1]
      view.dispatch({
        changes: safe.map((change) => ({
          from: change.from,
          to: change.to,
          insert: change.text
        })),
        selection: { anchor: last.from + last.text.length },
        effects: EditorView.scrollIntoView(last.from, { y: 'center' })
      })
      view.focus()
    }
  }))

  return (
    <div
      className="kjs-cm"
      ref={hostRef}
      data-path={path}
      style={{ ['--kjs-code-size' as string]: `${fontSize}px` }}
    />
  )
})
