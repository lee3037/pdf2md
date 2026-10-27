import { useMemo, useRef, useState } from "react"
import { ChevronsUpDown, Download, FilePlus2, FolderOpen, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Save } from "lucide-react"

import type { ChunkOptions, ConvertOptions, ConvertResult } from "@/lib/api"
import { pdfUrl } from "@/lib/api"
import type { Project } from "@/lib/project"
import { joinChunks, renderMarkdown, splitChunks } from "@/lib/chunks"
import { Button } from "@/components/ui/button"
import { CopyButton } from "@/components/ui/copy-button"
import { HaloBadge } from "@/components/ui/halo-badge"
import { HaloTextarea } from "@/components/ui/halo-input"
import { HaloTabs, HaloTabsContent, HaloTabsIndicator, HaloTabsList, HaloTabsTrigger } from "@/components/ui/halo-tabs"
import { ChunkFilterBar, ChunkList, type ChunkFilter } from "@/components/chunk-list"
import { Hint, Keys } from "@/components/hint"
import { ProjectNav } from "@/components/project-nav"
import { SettingsRail } from "@/components/settings-rail"
import { ConvertingStage, EmptyStage, type Pending } from "@/components/stage"

export interface Doc {
  jobId: string
  file: File
  /** 项目内的相对路径；拖入的外部文件没有 */
  path?: string
  result: ConvertResult
}

interface WorkspaceProps {
  project: Project
  /** 导航中高亮的文件（转换中或已打开） */
  activePath: string | null
  onSelectPath: (path: string) => void
  onRefresh: () => void
  onLeave: () => void
  doc: Doc | null
  pending: Pending | null
  onFile: (file: File) => void
  markdown: string
  separator: string
  onMarkdown: (md: string) => void
  convert: ConvertOptions
  onConvert: (o: ConvertOptions) => void
  reconvertable: boolean
  onReconvert: () => void
  draft: ChunkOptions
  onDraft: (o: ChunkOptions) => void
  pendingOverwrite: boolean
  busy: boolean
  onApply: () => void
  onDownload: () => void
  onSave: () => void
}

export function Workspace(props: WorkspaceProps) {
  const { project, doc, pending, markdown, separator } = props
  const [pdfOpen, setPdfOpen] = useState(() => window.innerWidth >= 1500)
  const [navOpen, setNavOpen] = useState(true)
  const [page, setPage] = useState<number | null>(null)
  const pickRef = useRef<HTMLInputElement>(null)
  const ready = doc !== null && pending === null
  const title = pending?.file.name ?? doc?.file.name

  return (
    <div className="grid h-svh grid-rows-[auto_1fr]">
      <header className="flex items-center gap-3 border-border/60 border-b px-5 py-3">
        <Hint label={navOpen ? "收起文件列表" : "展开文件列表"}>
          <Button aria-label={navOpen ? "收起文件列表" : "展开文件列表"} onClick={() => setNavOpen((v) => !v)} size="icon" variant="ghost">
            {navOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
        </Hint>
        <Hint label="切换项目">
          <Button className="max-w-56 gap-2 px-2" onClick={props.onLeave} variant="ghost">
            <FolderOpen />
            <span className="truncate">{project.name}</span>
            {!project.writable && <HaloBadge variant="outline">只读</HaloBadge>}
            <ChevronsUpDown className="text-muted-foreground" />
          </Button>
        </Hint>
        <span className="text-muted-foreground/60">/</span>
        <Hint label="打开目录外的 PDF（也可直接拖入页面）">
          <Button aria-label="新文件" disabled={!!pending} onClick={() => pickRef.current?.click()} size="icon" variant="ghost">
            <FilePlus2 />
          </Button>
        </Hint>
        <input
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) props.onFile(f)
          }}
          ref={pickRef}
          type="file"
        />
        <h1 className="min-w-0 truncate font-medium" title={title}>
          {title ?? <span className="text-muted-foreground">未选择文件</span>}
        </h1>
        {ready && <DocBadges result={doc.result} chunks={splitChunks(markdown, separator).length} />}
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
          {ready ? (
            <Hint label="复制全部 Markdown">
              <CopyButton aria-label="复制全部 Markdown" value={markdown} />
            </Hint>
          ) : (
            <CopyButton disabled value="" />
          )}
          {project.writable && (
            <Hint label="下载 .md">
              <Button aria-label="下载 .md" disabled={!ready} onClick={props.onDownload} size="icon" variant="ghost">
                <Download />
              </Button>
            </Hint>
          )}
          {project.writable ? (
            <Hint
              label={
                <>
                  保存为 PDF 旁的同名 .md <Keys>Ctrl S</Keys>
                </>
              }
            >
              <Button className="ml-1" disabled={!ready} onClick={props.onSave} size="lg">
                <Save />
                保存到目录
              </Button>
            </Hint>
          ) : ready ? (
            <Hint label="下载可直接导入 FastGPT 的 Markdown">
              <Button className="ml-1" onClick={props.onDownload} size="lg">
                <Download />
                下载 .md
              </Button>
            </Hint>
          ) : (
            <Button className="ml-1" disabled size="lg">
              <Download />
              下载 .md
            </Button>
          )}
        </div>
      </header>

      <div
        className={
          navOpen
            ? "grid min-h-0 grid-cols-[240px_280px_minmax(0,1fr)_auto]"
            : "grid min-h-0 grid-cols-[280px_minmax(0,1fr)_auto]"
        }
      >
        {navOpen && (
          <ProjectNav
            active={props.activePath}
            locked={!!pending}
            onRefresh={props.onRefresh}
            onSelect={props.onSelectPath}
            project={project}
          />
        )}
        <SettingsRail
          busy={props.busy || !!pending}
          convert={props.convert}
          onApply={props.onApply}
          onChange={props.onDraft}
          onConvert={props.onConvert}
          onReconvert={props.onReconvert}
          pendingOverwrite={ready && props.pendingOverwrite}
          reconvertable={ready && props.reconvertable}
          value={props.draft}
        />

        <main className="min-h-0 min-w-0">
          {pending ? (
            <ConvertingStage {...pending} />
          ) : doc ? (
            <ResultView
              draft={props.draft}
              markdown={markdown}
              onMarkdown={props.onMarkdown}
              onPage={(p) => (setPage(p), setPdfOpen(true))}
              separator={separator}
            />
          ) : (
            <EmptyStage
              label={project.files.length ? "从左侧选择 PDF，或拖入目录外的 PDF" : "拖入 PDF 或点击选择"}
              onFile={props.onFile}
            />
          )}
        </main>

        {ready && pdfOpen && (
          <section className="w-[min(46vw,760px)] border-border/60 border-l bg-muted/30">
            <iframe
              className="size-full"
              key={`${doc.jobId}:${page ?? 0}`}
              src={pdfUrl(doc.jobId, page)}
              title={doc.file.name}
            />
          </section>
        )}
      </div>
    </div>
  )
}

function DocBadges({ result, chunks }: { result: ConvertResult; chunks: number }) {
  const d = result.doc_stats
  return (
    <div className="hidden items-center gap-2 lg:flex">
      <HaloBadge tabularNums variant="secondary">{d.pages} 页</HaloBadge>
      <HaloBadge tabularNums variant="secondary">{chunks} 块</HaloBadge>
      {d.tables > 0 && <HaloBadge tabularNums variant="secondary">{d.tables} 表格</HaloBadge>}
      {d.ocr_pages > 0 && <HaloBadge tabularNums variant="outline">OCR {d.ocr_pages} 页</HaloBadge>}
    </div>
  )
}

interface ResultViewProps {
  markdown: string
  separator: string
  draft: ChunkOptions
  onMarkdown: (md: string) => void
  onPage: (page: number) => void
}

function ResultView({ markdown, separator, draft, onMarkdown, onPage }: ResultViewProps) {
  const [tab, setTab] = useState("chunks")
  const [filter, setFilter] = useState<ChunkFilter>("all")
  const chunks = useMemo(() => splitChunks(markdown, separator), [markdown, separator])

  return (
    <HaloTabs className="h-full min-h-0 grid-rows-[auto_1fr] gap-0" onValueChange={(v) => setTab(String(v))} value={tab}>
      <div className="px-6 pt-4">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
          <HaloTabsList variant="pill">
            <HaloTabsTrigger value="chunks">分块</HaloTabsTrigger>
            <HaloTabsTrigger value="markdown">Markdown</HaloTabsTrigger>
            <HaloTabsTrigger value="preview">预览</HaloTabsTrigger>
            <HaloTabsIndicator variant="pill" />
          </HaloTabsList>
          {tab === "chunks" && (
            <ChunkFilterBar
              chunks={chunks}
              maxChars={draft.max_chars}
              minChars={draft.min_chars}
              onChange={setFilter}
              value={filter}
            />
          )}
        </div>
      </div>
      <HaloTabsContent className="min-h-0 overflow-y-auto px-6 py-5" value="chunks">
        <div className="mx-auto max-w-3xl">
          <ChunkList
            chunks={chunks}
            filter={filter}
            maxChars={draft.max_chars}
            minChars={draft.min_chars}
            onChange={(next) => onMarkdown(joinChunks(next, separator))}
            onPage={onPage}
          />
        </div>
      </HaloTabsContent>
      <HaloTabsContent className="min-h-0 px-6 py-5" value="markdown">
        <HaloTextarea
          className="h-full min-h-[60vh] font-mono text-[13px] leading-relaxed"
          innerClassName="h-full"
          onChange={(e) => onMarkdown(e.target.value)}
          shellClassName="mx-auto h-full max-w-3xl"
          spellCheck={false}
          value={markdown}
        />
      </HaloTabsContent>
      <HaloTabsContent className="min-h-0 overflow-y-auto px-6 py-5" value="preview">
        <Preview markdown={markdown} separator={separator} />
      </HaloTabsContent>
    </HaloTabs>
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
