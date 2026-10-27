import { useCallback, useEffect, useRef, useState } from "react"

import type { ChunkOptions, ConvertResult } from "@/lib/api"
import { createJob, DEFAULT_CHUNK, DEFAULT_CONVERT, getJob, rechunk } from "@/lib/api"
import { useStored } from "@/lib/use-stored"
import { PolishedToaster, showPolishedToast } from "@/components/ui/halo-toast"
import { Landing } from "@/components/landing"
import { Workspace } from "@/components/workspace"

interface Doc {
  jobId: string
  filename: string
  result: ConvertResult
}

interface Pending {
  file: File
  done: number
  total: number
  seconds: number
}

const SEP_KEYS: (keyof ChunkOptions)[] = ["separator"]
const sameExceptSeparator = (a: ChunkOptions, b: ChunkOptions) =>
  (Object.keys(a) as (keyof ChunkOptions)[]).every((k) => SEP_KEYS.includes(k) || a[k] === b[k])

const fail = (title: string, e: unknown) =>
  showPolishedToast({ title, description: e instanceof Error ? e.message : String(e), rimVariant: "destructive", politeness: "alert" })

export default function App() {
  const [convertOpts, setConvertOpts] = useStored("pdf2md.convert", DEFAULT_CONVERT)
  const [draft, setDraft] = useStored("pdf2md.chunk", DEFAULT_CHUNK)
  const [pending, setPending] = useState<Pending | null>(null)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [markdown, setMarkdown] = useState("")
  const [applied, setApplied] = useState<ChunkOptions>(draft) // 当前 markdown 对应的分块参数
  const [edited, setEdited] = useState(false) // 有手动编辑：参数变更不再自动覆盖
  const [unsaved, setUnsaved] = useState(false) // 有未下载的修改
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<number | null>(null)

  // ---------------------------------------------------------------- 转换

  const start = useCallback(
    async (file: File) => {
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        showPolishedToast({ title: "请选择 PDF 文件", rimVariant: "destructive" })
        return
      }
      const t0 = Date.now()
      setPending({ file, done: 0, total: 0, seconds: 0 })
      try {
        const opts = { ...convertOpts, ...draft }
        const { id, page_count } = await createJob(file, opts)
        setPending({ file, done: 0, total: page_count, seconds: 0 })
        const tick = async () => {
          try {
            const job = await getJob(id)
            const seconds = Math.round((Date.now() - t0) / 1000)
            if (job.status === "done" && job.result) {
              setDoc({ jobId: id, filename: file.name, result: job.result })
              setMarkdown(job.result.markdown)
              setApplied(draft)
              setEdited(false)
              setUnsaved(true)
              setPending(null)
              job.result.warnings.forEach((w) => showPolishedToast({ title: w, duration: 8000 }))
              return
            }
            if (job.status === "error") {
              throw new Error(job.error || "转换失败")
            }
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

  useEffect(() => () => void (pollRef.current && clearTimeout(pollRef.current)), [])

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

  // 其他参数：无手动编辑时自动重新分块
  useEffect(() => {
    if (!othersChanged || edited || draft.max_chars < 100) return
    const t = window.setTimeout(apply, 450)
    return () => clearTimeout(t)
  }, [othersChanged, edited, draft, apply])

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
    a.download = doc.filename.replace(/\.pdf$/i, "") + ".md"
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    setUnsaved(false)
  }

  const newFile = () => {
    if (unsaved && !window.confirm("当前结果还未下载，确定放弃？")) return
    setDoc(null)
    setMarkdown("")
    setEdited(false)
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
      {doc ? (
        <Workspace
          busy={busy}
          draft={draft}
          filename={doc.filename}
          jobId={doc.jobId}
          markdown={markdown}
          onApply={apply}
          onDownload={download}
          onDraft={setDraft}
          onMarkdown={onMarkdown}
          onNewFile={newFile}
          pendingOverwrite={othersChanged && edited}
          result={doc.result}
          separator={applied.separator}
        />
      ) : (
        <Landing onFile={start} onOptions={setConvertOpts} options={convertOpts} pending={pending} />
      )}
      <PolishedToaster />
    </>
  )
}
