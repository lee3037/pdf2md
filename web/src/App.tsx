import { useCallback, useEffect, useRef, useState } from "react"
import { Upload } from "lucide-react"

import type { ChunkOptions, ConvertOptions } from "@/lib/api"
import { createJob, DEFAULT_CHUNK, DEFAULT_CONVERT, getJob, rechunk } from "@/lib/api"
import type { Project } from "@/lib/project"
import { mdName, readPdf, rescan, writeMarkdown } from "@/lib/project"
import { useStored } from "@/lib/use-stored"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { MorphButtonState } from "@/components/spectrumui/morph-button"
import { toast, Toaster } from "@/components/toaster"
import { FileDrawer, type FileDrawerView, type ParseSettings } from "@/components/file-drawer"
import { ProjectPicker } from "@/components/project-picker"
import type { Pending } from "@/components/stage"
import { Workspace, type Doc, type Preview } from "@/components/workspace"

const sameExceptSeparator = (a: ChunkOptions, b: ChunkOptions) =>
  (Object.keys(a) as (keyof ChunkOptions)[]).every((k) => k === "separator" || a[k] === b[k])
const sameConvert = (a: ConvertOptions, b: ConvertOptions) =>
  a.ocr_mode === b.ocr_mode && a.remove_header_footer === b.remove_header_footer &&
  (a.ocr_mode === "off" || a.ocr_dpi === b.ocr_dpi)

const fail = (title: string, e: unknown) =>
  toast({ title, description: e instanceof Error ? e.message : String(e), status: "error" })

const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === "application/pdf"

export default function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [convertOpts, setConvertOpts] = useStored("pdf2md.convert", DEFAULT_CONVERT)
  const [draft, setDraft] = useStored("pdf2md.chunk", DEFAULT_CHUNK)
  const [pending, setPending] = useState<Pending | null>(null)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [usedConvert, setUsedConvert] = useState<ConvertOptions>(convertOpts) // 当前结果对应的识别参数
  const [markdown, setMarkdown] = useState("")
  const [applied, setApplied] = useState<ChunkOptions>(draft) // 当前 markdown 对应的分块参数
  const [edited, setEdited] = useState(false) // 有手动编辑：分块参数变更不再自动覆盖
  const [unsaved, setUnsaved] = useState(false) // 有未保存/下载的结果
  const [busy, setBusy] = useState(false)
  const [saveState, setSaveState] = useState<MorphButtonState>("idle")
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  // seq 每次打开递增，用作 key：关闭时保留内容播放收起动画，再次打开时重置抽屉内状态
  const [drawer, setDrawer] = useState<{ path: string; view: FileDrawerView; open: boolean; seq: number } | null>(null)
  const pollRef = useRef<number | null>(null)
  const runRef = useRef(0) // 每次转换或离开项目递增，过期的轮询自行停止
  const overwriteOk = useRef<string | null>(null) // 已确认可覆盖已有 .md 的任务

  // ---------------------------------------------------------------- 转换

  const convert = useCallback(
    async (file: File, path?: string, settings: ParseSettings = { convert: convertOpts, chunk: draft }) => {
      const run = ++runRef.current
      const opts = { ...settings.convert, ...settings.chunk }
      setPreview(null)
      setPending({ file, path, done: 0, total: 0 })
      try {
        const { id, page_count } = await createJob(file, opts)
        if (run !== runRef.current) return
        setPending({ file, path, done: 0, total: page_count })
        const tick = async () => {
          try {
            const job = await getJob(id)
            if (run !== runRef.current) return
            if (job.status === "done" && job.result) {
              setDoc({ jobId: id, file, path, result: job.result })
              setMarkdown(job.result.markdown)
              setUsedConvert(settings.convert)
              setApplied(settings.chunk)
              setEdited(false)
              setUnsaved(true)
              setPending(null)
              job.result.warnings.forEach((w) => toast({ title: w, status: "info", duration: 8000 }))
              return
            }
            if (job.status === "error") throw new Error(job.error || "转换失败")
            setPending({ file, path, done: job.progress.done, total: job.progress.total })
            pollRef.current = window.setTimeout(tick, 700)
          } catch (e) {
            if (run !== runRef.current) return
            fail("转换失败", e)
            setPending(null)
          }
        }
        tick()
      } catch (e) {
        if (run !== runRef.current) return
        fail("上传失败", e)
        setPending(null)
      }
    },
    [convertOpts, draft]
  )

  const confirmReplace = useCallback(
    () => !(unsaved && doc) || window.confirm("当前结果还未保存，确定替换？"),
    [unsaved, doc]
  )

  const openFile = useCallback(
    (file: File, path?: string) => {
      if (pending) return
      if (!isPdf(file)) {
        toast({ title: "请选择 PDF 文件", status: "error" })
        return
      }
      if (!confirmReplace()) return
      convert(file, path)
    },
    [pending, confirmReplace, convert]
  )

  // ---------------------------------------------------------------- 侧栏点选：抽屉 → 解析或预览

  const openDrawer = (path: string, view: FileDrawerView) =>
    setDrawer((d) => ({ path, view, open: true, seq: (d?.seq ?? 0) + 1 }))
  const closeDrawer = () => setDrawer((d) => d && { ...d, open: false })

  const selectPath = (path: string) => {
    if (!project || pending || path === preview?.path) return
    if (path === doc?.path) {
      setPreview(null) // 回到已打开的结果
      return
    }
    openDrawer(path, "menu")
  }

  // 抽屉里确认的配置写回设置，并用它解析
  const parse = async (path: string, settings: ParseSettings) => {
    if (!project) return
    closeDrawer()
    if (!confirmReplace()) return
    try {
      const file = await readPdf(project, path)
      setConvertOpts(settings.convert)
      setDraft(settings.chunk)
      convert(file, path, settings)
    } catch (e) {
      fail("无法读取文件", e)
    }
  }

  const previewPath = async (path: string) => {
    if (!project) return
    closeDrawer()
    try {
      const file = await readPdf(project, path)
      setPreview({ path, url: URL.createObjectURL(file) })
    } catch (e) {
      fail("无法读取文件", e)
    }
  }

  // 预览换掉或关闭时释放上一个 blob URL
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview.url)), [preview])

  const reconvert = () => {
    if (!doc) return
    if (edited && !window.confirm("重新转换会丢弃手动编辑，确定继续？")) return
    convert(doc.file, doc.path)
  }

  useEffect(() => () => void (pollRef.current && clearTimeout(pollRef.current)), [])

  // 整页拖放：任意位置松开即转换（拖拽区自己处理的除外）
  useEffect(() => {
    if (!project) return
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
  }, [project, openFile])

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
    a.download = mdName(doc.file.name)
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    setUnsaved(false)
  }

  const save = useCallback(async () => {
    if (!project?.writable || !doc || pending || saveState !== "idle") return
    // 拖入的目录外文件保存到项目根目录
    const target = doc.path ?? doc.file.name
    const existed = project.files.some((f) => f.path === target && f.converted)
    if (existed && overwriteOk.current !== doc.jobId) {
      if (!window.confirm(`${mdName(target)} 已存在，确定覆盖？`)) return
      overwriteOk.current = doc.jobId
    }
    setSaveState("loading")
    try {
      await writeMarkdown(project, target, markdown)
      overwriteOk.current = doc.jobId
      setUnsaved(false)
      setProject((p) => p && { ...p, files: p.files.map((f) => (f.path === target ? { ...f, converted: true } : f)) })
      setSaveState("success")
    } catch (e) {
      fail("保存失败", e)
      setSaveState("error")
    }
  }, [project, doc, pending, saveState, markdown])

  // 保存按钮的成功 / 失败状态停留片刻后恢复
  useEffect(() => {
    if (saveState !== "success" && saveState !== "error") return
    const t = window.setTimeout(() => setSaveState("idle"), 1800)
    return () => clearTimeout(t)
  }, [saveState])

  useEffect(() => {
    if (!project?.writable) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [project, save])

  useEffect(() => {
    if (!unsaved) return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [unsaved])

  // ---------------------------------------------------------------- 项目

  // 先确认再打开：用户取消目录选择时，当前项目和结果保持不变
  const switchProject = async (task: () => Promise<Project | null>) => {
    if (unsaved && doc && !window.confirm("当前结果还未保存，确定切换项目？")) return
    if (pending && !window.confirm("正在转换，确定切换项目？")) return
    try {
      const next = await task()
      if (!next) return
      runRef.current += 1
      if (pollRef.current) clearTimeout(pollRef.current)
      setPending(null)
      setDoc(null)
      setMarkdown("")
      setEdited(false)
      setUnsaved(false)
      setPreview(null)
      setDrawer(null)
      setProject(next)
    } catch (e) {
      fail("无法打开目录", e)
    }
  }

  const refresh = async () => {
    if (!project) return
    try {
      setProject(await rescan(project))
    } catch (e) {
      fail("重新扫描失败", e)
    }
  }

  return (
    <TooltipProvider delay={350}>
      {project ? (
        <Workspace
          activePath={pending ? (pending.path ?? null) : (preview?.path ?? doc?.path ?? null)}
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
          onSwitchProject={switchProject}
          onClosePreview={() => setPreview(null)}
          onParsePreview={() => preview && openDrawer(preview.path, "config")}
          onMarkdown={onMarkdown}
          onReconvert={reconvert}
          onRefresh={refresh}
          onSave={save}
          onSelectPath={selectPath}
          pending={pending}
          preview={preview}
          pendingOverwrite={othersChanged && edited}
          project={project}
          saveState={saveState}
          reconvertable={!!doc && !sameConvert(convertOpts, usedConvert)}
          separator={applied.separator}
        />
      ) : (
        <ProjectPicker onOpen={setProject} />
      )}
      {dragging && (doc || pending) && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-foreground/20 border-dashed px-16 py-12 text-muted-foreground">
            <Upload className="size-8" strokeWidth={1.5} />
          </div>
        </div>
      )}
      {project && drawer && (
        <FileDrawer
          initialView={drawer.view}
          key={drawer.seq}
          onClose={closeDrawer}
          onParse={(settings) => parse(drawer.path, settings)}
          onPreview={() => previewPath(drawer.path)}
          open={drawer.open}
          path={drawer.path}
          settings={{ convert: convertOpts, chunk: draft }}
        />
      )}
      <Toaster />
    </TooltipProvider>
  )
}
