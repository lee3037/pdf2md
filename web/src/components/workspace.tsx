import { useMemo, useState } from "react"
import { Download, FilePlus2, PanelRightClose, PanelRightOpen } from "lucide-react"

import type { ChunkOptions, ConvertResult } from "@/lib/api"
import { pdfUrl } from "@/lib/api"
import { joinChunks, renderMarkdown, splitChunks } from "@/lib/chunks"
import { Button } from "@/components/ui/button"
import { CopyButton } from "@/components/ui/copy-button"
import { HaloBadge } from "@/components/ui/halo-badge"
import { HaloTextarea } from "@/components/ui/halo-input"
import { HaloTabs, HaloTabsContent, HaloTabsIndicator, HaloTabsList, HaloTabsTrigger } from "@/components/ui/halo-tabs"
import { ChunkFilterBar, ChunkList, type ChunkFilter } from "@/components/chunk-list"
import { SettingsRail } from "@/components/settings-rail"

interface WorkspaceProps {
  jobId: string
  filename: string
  result: ConvertResult
  markdown: string
  separator: string
  onMarkdown: (md: string) => void
  draft: ChunkOptions
  onDraft: (o: ChunkOptions) => void
  pendingOverwrite: boolean
  busy: boolean
  onApply: () => void
  onNewFile: () => void
  onDownload: () => void
}

export function Workspace(props: WorkspaceProps) {
  const { jobId, filename, result, markdown, separator, onMarkdown, draft } = props
  const [pdfOpen, setPdfOpen] = useState(() => window.innerWidth >= 1500)
  const [page, setPage] = useState<number | null>(null)
  const [tab, setTab] = useState("chunks")
  const [filter, setFilter] = useState<ChunkFilter>("all")
  const chunks = useMemo(() => splitChunks(markdown, separator), [markdown, separator])
  const d = result.doc_stats

  const openPage = (p: number) => {
    setPage(p)
    setPdfOpen(true)
  }

  return (
    <div className="grid h-svh grid-rows-[auto_1fr]">
      <header className="flex items-center gap-3 border-border/60 border-b px-5 py-3">
        <Button aria-label="新文件" onClick={props.onNewFile} size="icon" variant="ghost">
          <FilePlus2 />
        </Button>
        <h1 className="min-w-0 truncate font-medium" title={filename}>
          {filename}
        </h1>
        <div className="hidden items-center gap-2 lg:flex">
          <HaloBadge tabularNums variant="secondary">{d.pages} 页</HaloBadge>
          <HaloBadge tabularNums variant="secondary">{chunks.length} 块</HaloBadge>
          {d.tables > 0 && <HaloBadge tabularNums variant="secondary">{d.tables} 表格</HaloBadge>}
          {d.ocr_pages > 0 && <HaloBadge tabularNums variant="outline">OCR {d.ocr_pages} 页</HaloBadge>}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            aria-label={pdfOpen ? "收起原文" : "对照原文"}
            onClick={() => setPdfOpen((v) => !v)}
            size="icon"
            variant="ghost"
          >
            {pdfOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
          <CopyButton value={markdown} />
          <Button className="ml-1" onClick={props.onDownload} size="lg">
            <Download />
            下载 .md
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[280px_minmax(0,1fr)_auto]">
        <SettingsRail
          busy={props.busy}
          onApply={props.onApply}
          onChange={props.onDraft}
          pendingOverwrite={props.pendingOverwrite}
          value={draft}
        />

        <HaloTabs className="min-h-0 grid-rows-[auto_1fr] gap-0" onValueChange={(v) => setTab(String(v))} value={tab}>
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
                onPage={openPage}
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

        {pdfOpen && (
          <section className="w-[min(46vw,760px)] border-border/60 border-l bg-muted/30">
            <iframe className="size-full" key={page ?? 0} src={pdfUrl(jobId, page)} title={filename} />
          </section>
        )}
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
