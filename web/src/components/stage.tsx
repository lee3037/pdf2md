import { useEffect, useRef, useState, type DragEvent } from "react"
import { Layers, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"
import {
  DropTarget,
  EmptyAction,
  EmptyState,
  IconDocument,
  IconUpload,
} from "@/components/spectrumui/blocks/empty-states/empty-state-kit"
import { LoadingState } from "@/components/spectrumui/blocks/ai-assistants/loading-state"
import { StatusTracker } from "@/components/spectrumui/blocks/ai-assistants/status-tracker"

export interface Pending {
  file: File
  /** 项目内的相对路径 */
  path?: string
  done: number
  total: number
  /** 任务已成功；等进度播放完成后再显示结果。 */
  onComplete?: () => void
}

/** 未加载文档时的主区域：拖入或点击选择 PDF。 */
export function EmptyStage({ title, onFile }: { title: string; onFile: (file: File) => void }) {
  const [over, setOver] = useState(false)
  const depth = useRef(0) // 经过子元素时 dragenter/dragleave 会重复触发，用计数判断是否真正离开
  const pickRef = useRef<HTMLInputElement>(null)

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault()
    depth.current += 1
    setOver(true)
  }
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault()
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setOver(false)
  }
  // preventDefault 后，App 的整页拖放处理会跳过这次 drop
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setOver(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  return (
    <div className="flex h-full items-center justify-center px-6 pb-16">
      <DropTarget
        active={over}
        className="w-full max-w-xl px-8 py-14"
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <EmptyState
          actions={
            <EmptyAction icon={<IconUpload />} onClick={() => pickRef.current?.click()}>
              选择 PDF
            </EmptyAction>
          }
          backdrop="beam"
          icon={<IconUpload />}
          title={over ? "松开即开始转换" : title}
        />
        <input
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) onFile(f)
          }}
          ref={pickRef}
          type="file"
        />
      </DropTarget>
    </div>
  )
}

const STAGES = [
  { id: "upload", label: "上传" },
  { id: "parse", label: "解析" },
  { id: "chunk", label: "分块" },
]

const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

/** 转换中的主区域：上传 → 逐页解析 → 分块。 */
export function ConvertingStage({ file, done, total, onComplete }: Pending) {
  const [stage, setStage] = useState(0)
  const [displayedPages, setDisplayedPages] = useState(0)

  useEffect(() => {
    let timer: number | undefined
    if (stage === 0 && total > 0) {
      timer = window.setTimeout(() => setStage(1), 450)
    } else if (stage === 1) {
      if (displayedPages < Math.min(done, total)) {
        // 每次只前进一页；页数多时加快节奏，但不跳过中间数字。
        const interval = Math.max(24, Math.min(120, 1600 / total))
        timer = window.setTimeout(() => setDisplayedPages((pages) => pages + 1), interval)
      } else if (displayedPages === total) {
        // 等 StatusTracker 的 500 ms 进度线过渡结束，保留 n / n 页。
        timer = window.setTimeout(() => setStage(2), 500)
      }
    } else if (stage === 2 && onComplete) {
      timer = window.setTimeout(() => setStage(3), 500)
    } else if (stage === 3 && onComplete) {
      // 最后一枚完成图标有 200 ms 的入场动画。
      timer = window.setTimeout(onComplete, 250)
    }
    return () => window.clearTimeout(timer)
  }, [stage, displayedPages, done, total, onComplete])

  const label = ["正在上传", `正在解析 ${displayedPages} / ${total} 页`, "正在分块", "处理完成"][stage]
  const progress = stage === 1 ? displayedPages / total : stage === 2 && onComplete ? 1 : 0

  return (
    <div className="flex h-full items-center justify-center px-6 pb-16">
      <div className="flex w-full max-w-xl flex-col items-center gap-8 rounded-3xl border border-border/70 bg-card px-8 py-10 shadow-xs">
        <EmptyState
          backdrop="rings"
          description={formatBytes(file.size)}
          icon={<IconDocument />}
          medallionSize="sm"
          title={file.name}
        />
        <StatusTracker activeIndex={stage} progress={progress} stages={STAGES} />
        <LoadingState label={label} />
      </div>
    </div>
  )
}

/** 未解析时预览本地 PDF 原文。 */
export function PreviewStage({ url, title, onParse, onClose }: { url: string; title: string; onParse: () => void; onClose: () => void }) {
  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      <div className="flex items-center justify-end gap-1 border-border/60 border-b px-4 py-2">
        <Button className="rounded-full bg-sky-50 text-sky-700 hover:bg-sky-100" onClick={onParse} size="sm">
          <Layers />
          解析分块
        </Button>
        <Hint label="关闭预览">
          <Button aria-label="关闭预览" onClick={onClose} size="icon-sm" variant="ghost">
            <X />
          </Button>
        </Hint>
      </div>
      <iframe className="size-full bg-muted/30" src={url} title={title} />
    </div>
  )
}
