import { useMemo, useRef, useState } from "react"
import { Download, FilePlus2, PanelRightClose, PanelRightOpen } from "lucide-react"

import type { ChunkOptions, ConvertOptions, ConvertResult } from "@/lib/api"
import { pdfUrl } from "@/lib/api"
import { joinChunks, renderMarkdown, splitChunks } from "@/lib/chunks"
import { Button } from "@/components/ui/button"
import { CopyButton } from "@/components/ui/copy-button"
import { HaloBadge } from "@/components/ui/halo-badge"
import { HaloTextarea } from "@/components/ui/halo-input"
import { HaloTabs, HaloTabsContent, HaloTabsIndicator, HaloTabsList, HaloTabsTrigger } from "@/components/ui/halo-tabs"
import { ChunkFilterBar, ChunkList, type ChunkFilter } from "@/components/chunk-list"
import { Hint } from "@/components/hint"
import { SettingsRail } from "@/components/settings-rail"
import { ConvertingStage, EmptyStage, type Pending } from "@/components/stage"

export interface Doc {
  jobId: string
  file: File
  result: ConvertResult
}

interface WorkspaceProps {
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
}

export function Workspace(props: WorkspaceProps) {
  const { doc, pending, markdown, separator } = props
  const [pdfOpen, setPdfOpen] = useState(() => window.innerWidth >= 1500)
  const [page, setPage] = useState<number | null>(null)
  const pickRef = useRef<HTMLInputElement>(null)
  const ready = doc !== null && pending === null
  const title = pending?.file.name ?? doc?.file.name

  return (
    <div className="grid h-svh grid-rows-[auto_1fr]">
      <header className="flex items-center gap-3 border-border/60 border-b px-5 py-3">
        <Hint label="打开新的 PDF（也可直接拖入页面）">
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
          {title ?? (
            <>
              PDF <span className="text-muted-foreground">→</span> FastGPT 知识库
            </>
          )}
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
          {ready ? (
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

      <div className="grid min-h-0 grid-cols-[280px_minmax(0,1fr)_auto]">
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
            <EmptyStage onFile={props.onFile} />
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
