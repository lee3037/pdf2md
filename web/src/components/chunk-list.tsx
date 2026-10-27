import { memo, useMemo, useState } from "react"
import { Check, Combine, Pencil, Trash2, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { describeChunk, renderMarkdown, stripContext } from "@/lib/chunks"
import { Button } from "@/components/ui/button"
import { HaloSegmented } from "@/components/ui/halo-segmented"
import { HaloTextarea } from "@/components/ui/halo-input"
import { Hint, Keys } from "@/components/hint"

interface ChunkListProps {
  chunks: string[]
  maxChars: number
  minChars: number
  filter: ChunkFilter
  onChange: (chunks: string[]) => void
  onPage: (page: number) => void
}

export type ChunkFilter = "all" | "over" | "short"

/** 超长 / 偏短块的筛选项；没有异常块时返回 null（不显示筛选）。 */
export function ChunkFilterBar({ chunks, maxChars, minChars, value, onChange }: {
  chunks: string[]
  maxChars: number
  minChars: number
  value: ChunkFilter
  onChange: (f: ChunkFilter) => void
}) {
  const over = chunks.filter((c) => c.length > maxChars).length
  const short = chunks.filter((c) => c.length < minChars).length
  if (!over && !short) return null
  return (
    <HaloSegmented
      items={[
        { value: "all", label: `全部 ${chunks.length}` },
        ...(over ? [{ value: "over", label: `超长 ${over}` }] : []),
        ...(short ? [{ value: "short", label: `偏短 ${short}` }] : []),
      ]}
      onValueChange={(v) => onChange(v as ChunkFilter)}
      value={value}
    />
  )
}

export function ChunkList({ chunks, maxChars, minChars, filter, onChange, onPage }: ChunkListProps) {
  const views = useMemo(() => chunks.map(describeChunk), [chunks])
  const visible = views
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => filter === "all" || (filter === "over" ? v.chars > maxChars : v.chars < minChars))

  const update = (i: number, text: string | null, mergeNext = false) => {
    const next = [...chunks]
    if (mergeNext && i + 1 < next.length) {
      next.splice(i, 2, `${next[i]}\n\n${stripContext(next[i + 1])}`)
    } else if (text === null) {
      next.splice(i, 1)
    } else {
      next[i] = text
    }
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-4">
      {visible.map(({ v, i }) => (
        <ChunkCard
          index={i}
          isLast={i === chunks.length - 1}
          key={`${i}:${v.text.length}:${v.text.slice(0, 40)}`}
          onMerge={() => update(i, null, true)}
          onPage={onPage}
          onRemove={() => update(i, null)}
          onSave={(t) => update(i, t)}
          state={v.chars > maxChars ? "over" : v.chars < minChars ? "short" : "ok"}
          view={v}
        />
      ))}
    </div>
  )
}

interface ChunkCardProps {
  index: number
  view: ReturnType<typeof describeChunk>
  state: "ok" | "over" | "short"
  isLast: boolean
  onSave: (text: string) => void
  onRemove: () => void
  onMerge: () => void
  onPage: (page: number) => void
}

const ChunkCard = memo(function ChunkCard({ index, view, state, isLast, onSave, onRemove, onMerge, onPage }: ChunkCardProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const html = useMemo(() => renderMarkdown(stripContext(view.text)), [view.text])

  return (
    <article
      className={cn(
        "group rounded-2xl border bg-card shadow-xs transition-shadow [content-visibility:auto] [contain-intrinsic-size:auto_240px] hover:shadow-md",
        state === "over" && "border-destructive/50 ring-1 ring-destructive/20",
        state === "short" && "border-amber-400/60"
      )}
    >
      <header className="flex items-center gap-3 border-border/60 border-b px-4 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">{index + 1}</span>
        <span className={cn("tabular-nums", state === "over" && "font-semibold text-destructive", state === "short" && "text-amber-600")}>
          {view.chars} 字
        </span>
        {view.page !== null && (
          <Hint label={`在原文中查看第 ${view.pages} 页`}>
            <button
              className="rounded-full bg-muted px-2 py-0.5 tabular-nums text-foreground/80 transition-colors hover:bg-primary hover:text-primary-foreground"
              onClick={() => onPage(view.page!)}
              type="button"
            >
              P{view.pages}
            </button>
          </Hint>
        )}
        <span className="min-w-0 flex-1 truncate" title={view.path}>
          {view.path}
        </span>
        <div className="flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {draft === null ? (
            <>
              <Hint label={<>编辑 <Keys>双击</Keys></>}>
                <Button aria-label="编辑" onClick={() => setDraft(view.text)} size="icon-xs" variant="ghost">
                  <Pencil />
                </Button>
              </Hint>
              {!isLast && (
                <Hint label="与下一块合并">
                  <Button aria-label="与下一块合并" onClick={onMerge} size="icon-xs" variant="ghost">
                    <Combine />
                  </Button>
                </Hint>
              )}
              <Hint label="删除此块">
                <Button aria-label="删除" onClick={onRemove} size="icon-xs" variant="ghost">
                  <Trash2 />
                </Button>
              </Hint>
            </>
          ) : (
            <>
              <Hint label={<>保存 <Keys>Ctrl / ⌘ + Enter</Keys></>}>
                <Button aria-label="保存" onClick={() => (onSave(draft), setDraft(null))} size="icon-xs" variant="ghost">
                  <Check />
                </Button>
              </Hint>
              <Hint label={<>取消 <Keys>Esc</Keys></>}>
                <Button aria-label="取消" onClick={() => setDraft(null)} size="icon-xs" variant="ghost">
                  <X />
                </Button>
              </Hint>
            </>
          )}
        </div>
      </header>
      {draft === null ? (
        <div className="md px-5 py-4" dangerouslySetInnerHTML={{ __html: html }} onDoubleClick={() => setDraft(view.text)} />
      ) : (
        <div className="p-3">
          <HaloTextarea
            autoFocus
            className="min-h-64 font-mono text-[13px] leading-relaxed"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setDraft(null)
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                onSave(draft)
                setDraft(null)
              }
            }}
            spellCheck={false}
            value={draft}
          />
        </div>
      )}
    </article>
  )
})
