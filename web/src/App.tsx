import { useCallback, useEffect, useRef, useState } from "react"
import { Upload } from "lucide-react"

import type { ChunkOptions, ConvertOptions } from "@/lib/api"
import { createJob, DEFAULT_CHUNK, DEFAULT_CONVERT, getJob, rechunk } from "@/lib/api"
import { useStored } from "@/lib/use-stored"
import { PolishedToaster, showPolishedToast } from "@/components/ui/halo-toast"
import type { Pending } from "@/components/stage"
import { Workspace, type Doc } from "@/components/workspace"

const sameExceptSeparator = (a: ChunkOptions, b: ChunkOptions) =>
  (Object.keys(a) as (keyof ChunkOptions)[]).every((k) => k === "separator" || a[k] === b[k])
const sameConvert = (a: ConvertOptions, b: ConvertOptions) =>
  a.ocr_mode === b.ocr_mode && a.remove_header_footer === b.remove_header_footer &&
  (a.ocr_mode === "off" || a.ocr_dpi === b.ocr_dpi)

const fail = (title: string, e: unknown) =>
  showPolishedToast({ title, description: e instanceof Error ? e.message : String(e), rimVariant: "destructive", politeness: "alert" })

const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === "application/pdf"

export default function App() {
  const [convertOpts, setConvertOpts] = useStored("pdf2md.convert", DEFAULT_CONVERT)
  const [draft, setDraft] = useStored("pdf2md.chunk", DEFAULT_CHUNK)
  const [pending, setPending] = useState<Pending | null>(null)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [usedConvert, setUsedConvert] = useState<ConvertOptions>(convertOpts) // 当前结果对应的识别参数
  const [markdown, setMarkdown] = useState("")
  const [applied, setApplied] = useState<ChunkOptions>(draft) // 当前 markdown 对应的分块参数
  const [edited, setEdited] = useState(false) // 有手动编辑：分块参数变更不再自动覆盖
  const [unsaved, setUnsaved] = useState(false) // 有未下载的结果
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const pollRef = useRef<number | null>(null)

  // ---------------------------------------------------------------- 转换

  const convert = useCallback(
    async (file: File) => {
      const t0 = Date.now()
      const opts = { ...convertOpts, ...draft }
      setPending({ file, done: 0, total: 0, seconds: 0 })
      try {
        const { id, page_count } = await createJob(file, opts)
        setPending({ file, done: 0, total: page_count, seconds: 0 })
        const tick = async () => {
          try {
            const job = await getJob(id)
            if (job.status === "done" && job.result) {
              setDoc({ jobId: id, file, result: job.result })
              setMarkdown(job.result.markdown)
              setUsedConvert(convertOpts)
              setApplied(draft)
              setEdited(false)
              setUnsaved(true)
              setPending(null)
              job.result.warnings.forEach((w) => showPolishedToast({ title: w, duration: 8000 }))
              return
            }
            if (job.status === "error") throw new Error(job.error || "转换失败")
            const seconds = Math.round((Date.now() - t0) / 1000)
            setPending({ file, done: job.progress.done, total: job.progress.total, seconds })
            pollRef.current = window.setTimeout(tick, 700)
          } catch (e) {
            fail("转换失败", e)
            setPending(null)
          }
        }
        tick()
      } catch (e) {
        fail("上传失败", e)
        setPending(null)
      }
    },
    [convertOpts, draft]
  )

  const openFile = useCallback(
    (file: File) => {
      if (pending) return
      if (!isPdf(file)) {
        showPolishedToast({ title: "请选择 PDF 文件", rimVariant: "destructive" })
        return
      }
      if (unsaved && doc && !window.confirm("当前结果还未下载，确定替换？")) return
      convert(file)
    },
    [pending, unsaved, doc, convert]
  )

  const reconvert = () => {
    if (!doc) return
    if (edited && !window.confirm("重新转换会丢弃手动编辑，确定继续？")) return
    convert(doc.file)
  }

  useEffect(() => () => void (pollRef.current && clearTimeout(pollRef.current)), [])

  // 整页拖放：任意位置松开即转换（拖拽区自己处理的除外）
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files")
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth += 1
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault()
    const drop = (e: DragEvent) => {
      depth = 0
      setDragging(false)
      if (!hasFiles(e)) return
      const handled = e.defaultPrevented
      e.preventDefault()
      const f = e.dataTransfer?.files[0]
      if (f && !handled) openFile(f)
    }
    window.addEventListener("dragenter", enter)
    window.addEventListener("dragleave", leave)
    window.addEventListener("dragover", over)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("dragenter", enter)
      window.removeEventListener("dragleave", leave)
      window.removeEventListener("dragover", over)
      window.removeEventListener("drop", drop)
    }
  }, [openFile])

  // ---------------------------------------------------------------- 分块参数

  const apply = useCallback(async () => {
    if (!doc) return
    const opts = { ...draft, separator: draft.separator.trim() ? draft.separator : applied.separator }
    setBusy(true)
    try {
      const result = await rechunk(doc.jobId, opts)
      setDoc({ ...doc, result })
      setMarkdown(result.markdown)
      setApplied(opts)
      setEdited(false)
      setUnsaved(true)
    } catch (e) {
      fail("重新分块失败", e)
    } finally {
      setBusy(false)
    }
  }, [doc, draft, applied.separator])

  // 只改分隔符：直接替换，保留手动编辑
  useEffect(() => {
    if (!doc || !draft.separator.trim() || draft.separator === applied.separator) return
    const t = window.setTimeout(() => {
      setMarkdown((md) => md.split(applied.separator).join(draft.separator))
      setApplied((a) => ({ ...a, separator: draft.separator }))
    }, 300)
    return () => clearTimeout(t)
  }, [doc, draft.separator, applied.separator])

  const othersChanged = !!doc && !sameExceptSeparator(draft, applied)

  // 其他分块参数：无手动编辑时自动重新分块
  useEffect(() => {
    if (!othersChanged || edited || pending || draft.max_chars < 100) return
    const t = window.setTimeout(apply, 450)
    return () => clearTimeout(t)
  }, [othersChanged, edited, pending, draft, apply])

  // ---------------------------------------------------------------- 编辑与导出

  const onMarkdown = (md: string) => {
    setMarkdown(md)
    setEdited(true)
    setUnsaved(true)
  }

  const download = () => {
    if (!doc) return
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = doc.file.name.replace(/\.pdf$/i, "") + ".md"
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    setUnsaved(false)
  }

  useEffect(() => {
    if (!unsaved) return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [unsaved])

  return (
    <>
      <Workspace
        busy={busy}
        convert={convertOpts}
        doc={doc}
        draft={draft}
        markdown={markdown}
        onApply={apply}
        onConvert={setConvertOpts}
        onDownload={download}
        onDraft={setDraft}
        onFile={openFile}
        onMarkdown={onMarkdown}
        onReconvert={reconvert}
        pending={pending}
        pendingOverwrite={othersChanged && edited}
        reconvertable={!!doc && !sameConvert(convertOpts, usedConvert)}
        separator={applied.separator}
      />
      {dragging && (doc || pending) && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-foreground/20 border-dashed px-16 py-12 text-muted-foreground">
            <Upload className="size-8" strokeWidth={1.5} />
          </div>
        </div>
      )}
      <PolishedToaster />
    </>
  )
}
