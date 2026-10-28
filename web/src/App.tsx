import { useCallback, useEffect, useRef, useState } from "react"
import { Upload } from "lucide-react"

import type { ChunkOptions, ConvertOptions } from "@/lib/api"
import { createJob, DEFAULT_CHUNK, DEFAULT_CONVERT, getJob, rechunk } from "@/lib/api"
import type { MarkdownFile, Project } from "@/lib/project"
import { addPdfToProject, nextMarkdownFile, readMarkdown, readPdf, rescan, writeMarkdown } from "@/lib/project"
import { loadSeparators } from "@/lib/separators"
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

interface Artifact extends MarkdownFile {
  doc: Doc
  markdown: string
  convert: ConvertOptions | null
  chunk: ChunkOptions
  unsaved: boolean
  saved: boolean
}

const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === "application/pdf"

export default function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [convertOpts, setConvertOpts] = useStored("stratum.convert", DEFAULT_CONVERT)
  const [draft, setDraft] = useStored("stratum.chunk", DEFAULT_CHUNK)
  const [pending, setPending] = useState<Pending | null>(null)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [activeArtifact, setActiveArtifact] = useState<string | null>(null)
  const current = artifacts.find((artifact) => artifact.path === activeArtifact)
  const doc = current?.doc ?? null
  const markdown = current?.markdown ?? ""
  const usedConvert = current?.convert ?? null
  const applied = current?.chunk ?? draft
  const unsaved = artifacts.some((artifact) => artifact.unsaved)
  const [busy, setBusy] = useState(false)
  const [saveState, setSaveState] = useState<MorphButtonState>("idle")
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  // seq 每次打开递增，用作 key：关闭时保留内容播放收起动画，再次打开时重置抽屉内状态
  const [drawer, setDrawer] = useState<{ path: string; view: FileDrawerView; reparse: boolean; open: boolean; seq: number } | null>(null)
  const pollRef = useRef<number | null>(null)
  const runRef = useRef(0) // 每次转换或离开项目递增，过期的轮询自行停止
  const overwriteOk = useRef<string | null>(null) // 已确认可保存修改的产物路径

  const updateCurrent = useCallback((changes: Partial<Artifact>) => {
    setArtifacts((items) => items.map((item) => item.path === activeArtifact ? { ...item, ...changes } : item))
  }, [activeArtifact])

  const showArtifact = useCallback((artifact: Artifact) => {
    setArtifacts((items) => [...items.filter((item) => item.path !== artifact.path), artifact])
    setActiveArtifact(artifact.path)
    setSaveState("idle")
    setPreview(null)
  }, [])

  // 每次生成独立版本。旧版本的文本、编辑和配置均留在会话中。
  const publishResult = useCallback(async (
    source: Omit<Doc, "mdPath">,
    text: string,
    settings: ParseSettings,
  ) => {
    if (!project) return
    const scanned = await rescan(project)
    const output = nextMarkdownFile(source.path ?? source.file.name, [...scanned.artifacts, ...artifacts])
    setProject(scanned)
    showArtifact({
      ...output, doc: { ...source, mdPath: output.path }, markdown: text,
      convert: settings.convert, chunk: settings.chunk, unsaved: true, saved: false,
    })
  }, [project, artifacts, showArtifact])

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
              await publishResult({ jobId: id, file, path, result: job.result }, job.result.markdown, settings)
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
    [convertOpts, draft, publishResult]
  )

  const openFile = useCallback(
    (file: File, path?: string) => {
      if (pending || busy || saveState === "loading") return
      if (!isPdf(file)) {
        toast({ title: "请选择 PDF 文件", status: "error" })
        return
      }
      convert(file, path)
    },
    [pending, busy, saveState, convert]
  )

  const addPdf = async (file: File) => {
    if (!project || pending || busy || saveState === "loading") return
    if (!isPdf(file)) {
      toast({ title: "请选择 PDF 文件", status: "error" })
      return
    }
    setBusy(true)
    try {
      setProject(await addPdfToProject(project, file))
      toast({ title: `已添加 ${file.name}`, status: "success" })
    } catch (e) {
      fail("添加 PDF 失败", e)
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------------- 侧栏点选：抽屉 → 解析或预览

  const openDrawer = (path: string, view: FileDrawerView, reparse = false) =>
    setDrawer((d) => ({ path, view, reparse, open: true, seq: (d?.seq ?? 0) + 1 }))
  const closeDrawer = () => setDrawer((d) => d && { ...d, open: false })

  const selectPath = (path: string) => {
    if (!project || pending || busy || saveState === "loading") return
    const latest = [...project.artifacts, ...artifacts]
      .filter((artifact) => artifact.pdfPath === path)
      .sort((a, b) => b.version - a.version)[0]
    if (latest) {
      void selectArtifact(latest.path)
      return
    }
    if (path === preview?.path) return
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

  const selectArtifact = async (path: string) => {
    if (!project || pending || busy || saveState === "loading") return
    if (artifacts.some((artifact) => artifact.path === path)) {
      setActiveArtifact(path)
      setSaveState("idle")
      setPreview(null)
      return
    }
    const output = project.artifacts.find((artifact) => artifact.path === path)
    if (!output) return
    setBusy(true)
    try {
      const [file, text] = await Promise.all([readPdf(project, output.pdfPath), readMarkdown(project, path)])
      const lines = new Set(text.split(/\r?\n/))
      const separator = [draft.separator, ...loadSeparators()].find((s) => lines.has(s)) ?? draft.separator
      showArtifact({
        ...output,
        doc: { jobId: null, file, path: output.pdfPath, mdPath: path, result: null },
        markdown: text, convert: null, chunk: { ...draft, separator },
        unsaved: false, saved: true,
      })
    } catch (e) {
      fail("无法打开 Markdown", e)
    } finally {
      setBusy(false)
    }
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

  // 确认配置后生成新版本；仅改分隔符时沿用当前版本的手动编辑。
  const reparse = async (settings: ParseSettings) => {
    if (!current || !doc || pending || busy) return
    const reuseParsed = !!doc.jobId && !!usedConvert && sameConvert(settings.convert, usedConvert)
    const separatorOnly = reuseParsed && sameExceptSeparator(settings.chunk, applied) && settings.chunk.separator !== applied.separator
    closeDrawer()
    setConvertOpts(settings.convert)
    setDraft(settings.chunk)

    if (!reuseParsed) {
      convert(doc.file, doc.path, settings)
      return
    }
    setBusy(true)
    try {
      if (separatorOnly) {
        const text = markdown.split(applied.separator).join(settings.chunk.separator)
        await publishResult(doc, text, settings)
      } else if (doc.jobId) {
        const result = await rechunk(doc.jobId, settings.chunk)
        await publishResult({ ...doc, result }, result.markdown, settings)
      }
    } catch (e) {
      fail("重新分块失败", e)
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------------- 编辑与导出

  const onMarkdown = (md: string) => {
    updateCurrent({ markdown: md, unsaved: true })
  }

  const download = () => {
    if (!doc) return
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = doc.mdPath.split("/").pop()!
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    updateCurrent({ unsaved: false })
  }

  const save = useCallback(async () => {
    if (!project?.writable || !current || pending || preview || busy || saveState !== "idle") return
    if (current.saved && overwriteOk.current !== current.path) {
      if (!window.confirm(`确定保存对 ${current.path} 的修改？`)) return
    }
    setSaveState("loading")
    try {
      await writeMarkdown(project, current.path, current.markdown, current.saved)
      overwriteOk.current = current.path
      updateCurrent({ unsaved: false, saved: true })
      const output = { path: current.path, pdfPath: current.pdfPath, version: current.version }
      setProject((p) => p && {
        ...p,
        files: p.files.map((file) => file.path === current.pdfPath ? { ...file, converted: true } : file),
        artifacts: [...p.artifacts.filter((file) => file.path !== current.path), output],
      })
      setSaveState("success")
    } catch (e) {
      fail("保存失败", e)
      setSaveState("error")
    }
  }, [project, current, pending, preview, busy, saveState, updateCurrent])

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
    if (busy || saveState === "loading") return
    if (unsaved && !window.confirm("项目中有未保存的版本，确定切换项目？")) return
    if (pending && !window.confirm("正在转换，确定切换项目？")) return
    try {
      const next = await task()
      if (!next) return
      runRef.current += 1
      if (pollRef.current) clearTimeout(pollRef.current)
      setPending(null)
      setArtifacts([])
      setActiveArtifact(null)
      setSaveState("idle")
      overwriteOk.current = null
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
          activePath={drawer?.open ? drawer.path : pending ? (pending.path ?? null) : (preview?.path ?? doc?.path ?? null)}
          busy={busy}
          doc={doc}
          draft={applied}
          markdown={markdown}
          onDownload={download}
          onAddPdf={addPdf}
          onFile={openFile}
          onSwitchProject={switchProject}
          onClosePreview={() => setPreview(null)}
          onParsePreview={() => preview && openDrawer(preview.path, "config")}
          onMarkdown={onMarkdown}
          onReparse={() => doc && openDrawer(doc.path ?? doc.file.name, "config", true)}
          onSelectArtifact={selectArtifact}
          artifacts={artifacts.map(({ path, pdfPath, version, unsaved }) => ({ path, pdfPath, version, unsaved }))}
          onRefresh={refresh}
          onSave={save}
          onSelectPath={selectPath}
          pending={pending}
          preview={preview}
          project={project}
          saveState={saveState}
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
          onParse={(settings) => drawer.reparse ? reparse(settings) : parse(drawer.path, settings)}
          onPreview={() => previewPath(drawer.path)}
          open={drawer.open}
          path={drawer.path}
          reparse={drawer.reparse}
          settings={drawer.reparse ? { convert: usedConvert ?? convertOpts, chunk: applied } : { convert: convertOpts, chunk: draft }}
        />
      )}
      <Toaster />
    </TooltipProvider>
  )
}
