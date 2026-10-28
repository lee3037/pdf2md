import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react"
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"

import type { ChunkOptions, ConvertResult } from "@/lib/api"
import { pdfUrl } from "@/lib/api"
import type { Project } from "@/lib/project"
import { joinChunks, renderMarkdown, splitChunks } from "@/lib/chunks"
import { Button } from "@/components/ui/button"
import { NumberTicker } from "@/components/motion/number-ticker"
import { AutosizeTextarea } from "@/components/spectrumui/autosize-textarea"
import { ModelSelector } from "@/components/spectrumui/blocks/ai-assistants/model-selector"
import type { MorphButtonState } from "@/components/spectrumui/morph-button"
import { UndoPill } from "@/components/spectrumui/undo-pill"
import { ChunkFilterBar, ChunkList, type ChunkFilter } from "@/components/chunk-list"
import { Hint } from "@/components/hint"
import { Logo } from "@/components/logo"
import { ProjectNav } from "@/components/project-nav"
import { ProjectSwitcher } from "@/components/project-switcher"
import { ArtifactNav, type ArtifactNavItem } from "@/components/artifact-nav"
import { ResultActions } from "@/components/result-actions"
import { ConvertingStage, EmptyStage, PreviewStage, type Pending } from "@/components/stage"

/** 未解析的原文预览：本地文件的 blob URL */
export interface Preview {
  path: string
  url: string
}

export interface Doc {
  /** 从目录打开的 Markdown 没有服务端任务。 */
  jobId: string | null
  file: File
  /** 项目内的相对路径；拖入的外部文件没有 */
  path?: string
  mdPath: string
  result: ConvertResult | null
}

interface WorkspaceProps {
  project: Project
  /** 导航中高亮的文件（抽屉操作中、预览中、转换中或已打开） */
  activePath: string | null
  onSelectPath: (path: string) => void
  onRefresh: () => void
  onSwitchProject: (task: () => Promise<Project | null>) => void
  doc: Doc | null
  pending: Pending | null
  preview: Preview | null
  /** 从预览直接进入解析配置 */
  onParsePreview: () => void
  onClosePreview: () => void
  onAddPdf: (file: File) => void
  onFile: (file: File) => void
  markdown: string
  separator: string
  onMarkdown: (md: string) => void
  onReparse: () => void
  onSelectArtifact: (path: string) => void
  artifacts: ArtifactNavItem[]
  draft: ChunkOptions
  busy: boolean
  onDownload: () => void
  onSave: () => void
  saveState: MorphButtonState
}

const SIDEBAR_WIDTH = 300 // 与下方 grid-cols-[300px_…] 保持一致
const PDF_MIN_WIDTH = 360
const MAIN_MIN_WIDTH = 480 // 拖宽 PDF 面板时给结果区保留的最小宽度

export function Workspace(props: WorkspaceProps) {
  const { project, doc, pending, preview, markdown, separator } = props
  const [pdfOpen, setPdfOpen] = useState(() => window.innerWidth >= 1500)
  const [pdfWidth, setPdfWidth] = useState(640)
  const [navOpen, setNavOpen] = useState(true)
  const [page, setPage] = useState<number | null>(null)
  // 预览其他文件时，复制、下载、保存都不针对当前结果，先禁用
  const ready = doc !== null && pending === null && preview === null
  const title = pending ? (pending.path ?? pending.file.name) : (preview?.path ?? doc?.path ?? doc?.file.name)

  // 拖动 PDF 面板左边缘调整宽度；pointer capture 保证鼠标经过 iframe 时仍能收到事件
  const resizePdf = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return
    const max = window.innerWidth - (navOpen ? SIDEBAR_WIDTH : 0) - MAIN_MIN_WIDTH
    setPdfWidth(Math.round(Math.min(max, Math.max(PDF_MIN_WIDTH, window.innerWidth - e.clientX))))
  }

  return (
    // 整页不滚动：只有侧栏、结果区各自滚动，页头始终固定在顶部
    <div className="relative grid h-svh grid-rows-[auto_1fr] overflow-hidden">
      <header className="flex items-center gap-2 border-border/60 border-b px-4 py-2.5">
        <Logo className="mr-1" />
        <Hint label={navOpen ? "收起侧栏" : "展开侧栏"}>
          <Button aria-label={navOpen ? "收起侧栏" : "展开侧栏"} onClick={() => setNavOpen((v) => !v)} size="icon" variant="ghost">
            {navOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
        </Hint>
        <ProjectSwitcher onSwitch={props.onSwitchProject} project={project} />
        <span className="text-muted-foreground/60">/</span>
        <h1 className="min-w-0 truncate font-medium" title={title}>
          {title ?? <span className="text-muted-foreground">未选择文件</span>}
        </h1>
        <div className="ml-auto flex items-center gap-1">
          {ready && (
            <Hint label={pdfOpen ? "收起原文" : "对照原文 PDF"}>
              <Button
                aria-label={pdfOpen ? "收起原文" : "对照原文"}
                onClick={() => setPdfOpen((v) => !v)}
                size="icon"
                variant="ghost"
              >
                {pdfOpen ? <PanelRightClose /> : <PanelRightOpen />}
              </Button>
            </Hint>
          )}
        </div>
      </header>

      <div className={navOpen ? "grid min-h-0 grid-cols-[300px_minmax(0,1fr)_auto]" : "grid min-h-0 grid-cols-[minmax(0,1fr)_auto]"}>
        {navOpen && (
          <aside className="flex min-h-0 flex-col border-border/60 border-r">
            <ProjectNav
              active={props.activePath}
              locked={!!pending || props.busy || props.saveState === "loading"}
              onAddPdf={props.onAddPdf}
              onRefresh={props.onRefresh}
              onSelect={props.onSelectPath}
              project={project}
            />
            <ArtifactNav
              artifacts={props.artifacts}
              currentPath={ready ? doc.mdPath : null}
              locked={!!pending || props.busy || props.saveState === "loading"}
              onSelect={props.onSelectArtifact}
              project={project}
            />
          </aside>
        )}

        <main className="min-h-0 min-w-0">
          {pending ? (
            <ConvertingStage {...pending} />
          ) : preview ? (
            <PreviewStage onClose={props.onClosePreview} onParse={props.onParsePreview} title={preview.path} url={preview.url} />
          ) : doc ? (
            <ResultView
              actions={
                <ResultActions
                  busy={props.busy}
                  markdown={markdown}
                  onDownload={props.onDownload}
                  onReparse={props.onReparse}
                  onSave={props.onSave}
                  saveState={props.saveState}
                  writable={project.writable}
                />
              }
              busy={props.busy}
              key={doc.mdPath}
              draft={props.draft}
              markdown={markdown}
              onMarkdown={props.onMarkdown}
              onPage={(p) => (setPage(p), setPdfOpen(true))}
              result={doc.result}
              separator={separator}
            />
          ) : (
            <EmptyStage
              onFile={props.onFile}
              title={project.files.length ? "从左侧选择 PDF，或拖入目录外的 PDF" : "拖入 PDF 或点击选择"}
            />
          )}
        </main>

        {ready && pdfOpen && (
          <section className="relative border-border/60 border-l bg-muted/30" style={{ width: pdfWidth }}>
            <div
              aria-hidden
              className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-foreground/10 active:bg-foreground/15"
              onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
              onPointerMove={resizePdf}
            />
            <SourcePdf doc={doc} page={page} />
          </section>
        )}
      </div>
    </div>
  )
}

/** 服务端结果与本地 Markdown 共用原文面板；卸载或换文件时释放本地 URL。 */
function SourcePdf({ doc: { file, jobId }, page }: { doc: Doc; page: number | null }) {
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const url = jobId ? pdfUrl(jobId) : URL.createObjectURL(file)
    if (frame.current) frame.current.src = `${url}${page ? `#page=${page}` : ""}`
    return () => {
      if (!jobId) URL.revokeObjectURL(url)
    }
  }, [file, jobId, page])
  return <iframe className="size-full" key={`${jobId ?? file.name}:${page ?? 0}`} ref={frame} title={file.name} />
}

/** 结果工具栏右侧的文档统计。 */
function DocStats({ result, chunks }: { result: ConvertResult | null; chunks: number }) {
  const d = result?.doc_stats
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
      {d && <><span>{d.pages} 页</span><span>·</span></>}
      <span className="inline-flex items-center gap-0.5">
        <NumberTicker value={chunks} /> 块
      </span>
      {d && d.tables > 0 && (
        <>
          <span>·</span>
          <span>{d.tables} 表格</span>
        </>
      )}
      {d && d.ocr_pages > 0 && (
        <>
          <span>·</span>
          <span>OCR {d.ocr_pages} 页</span>
        </>
      )}
    </div>
  )
}

type Tab = "chunks" | "markdown" | "preview"

interface ResultViewProps {
  actions: ReactNode
  busy: boolean
  result: ConvertResult | null
  markdown: string
  separator: string
  draft: ChunkOptions
  onMarkdown: (md: string) => void
  onPage: (page: number) => void
}

function ResultView({ actions, busy, result, markdown, separator, draft, onMarkdown, onPage }: ResultViewProps) {
  const [tab, setTab] = useState<Tab>("chunks")
  const [filter, setFilter] = useState<ChunkFilter>("all")
  // 最近一次删除块：markdown 仍是删除后的内容时才可撤销
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null)
  const chunks = useMemo(() => splitChunks(markdown, separator), [markdown, separator])

  const changeChunks = (next: string[], removed = false) => {
    const md = joinChunks(next, separator)
    setUndo(removed ? { before: markdown, after: md } : null)
    onMarkdown(md)
  }

  return (
    <div className="relative grid h-full min-h-0 grid-rows-[auto_1fr]">
      <div className="px-6 pt-4">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-2">
          <ModelSelector
            ariaLabel="结果视图"
            className="[&_button]:text-sm"
            models={[
              { id: "chunks", name: "分块" },
              { id: "markdown", name: "Markdown" },
              { id: "preview", name: "预览" },
            ]}
            onChange={(v) => setTab(v as Tab)}
            value={tab}
            variant="Segmented"
          />
          <div className="ml-auto flex min-w-0 flex-1 justify-end">{actions}</div>
          <div className="flex min-h-8 w-full flex-wrap items-center gap-2">
            {tab === "chunks" && (
              <ChunkFilterBar
                chunks={chunks}
                maxChars={draft.max_chars}
                minChars={draft.min_chars}
                onChange={setFilter}
                value={filter}
              />
            )}
            <div className="ml-auto"><DocStats chunks={chunks.length} result={result} /></div>
          </div>
        </div>
      </div>

      <div aria-busy={busy} className="min-h-0 overflow-y-auto px-6 py-5" inert={busy}>
        {tab === "chunks" && (
          <div className="mx-auto max-w-3xl">
            <ChunkList
              chunks={chunks}
              filter={filter}
              maxChars={draft.max_chars}
              minChars={draft.min_chars}
              onChange={changeChunks}
              onPage={onPage}
            />
          </div>
        )}
        {tab === "markdown" && (
          <AutosizeTextarea
            className="mx-auto max-w-3xl rounded-xl font-mono text-[13px] leading-relaxed"
            minHeight={480}
            onChange={(e) => onMarkdown(e.target.value)}
            spellCheck={false}
            value={markdown}
          />
        )}
        {tab === "preview" && <Preview markdown={markdown} separator={separator} />}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-40 flex justify-center">
        <UndoPill
          label="已删除 1 个块"
          onExpire={() => setUndo(null)}
          onUndo={() => {
            if (undo) onMarkdown(undo.before)
            setUndo(null)
          }}
          open={undo !== null && undo.after === markdown}
          undoLabel="撤销"
        />
      </div>
    </div>
  )
}

function Preview({ markdown, separator }: { markdown: string; separator: string }) {
  const html = useMemo(() => {
    const out = renderMarkdown(markdown)
    const esc = separator.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)
    return out.split(`<p>${esc}</p>`).join('<hr class="chunk-sep" />')
  }, [markdown, separator])
  return <article className="md mx-auto max-w-3xl" dangerouslySetInnerHTML={{ __html: html }} />
}
