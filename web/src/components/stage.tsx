import { useRef, useState, type DragEvent } from "react"
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
export function ConvertingStage({ file, done, total }: Pending) {
  // 拿到页数说明上传已完成；全部页面解析完后只剩分块
  const stage = total === 0 ? 0 : done < total ? 1 : 2
  const label = ["正在上传", `正在解析 ${done} / ${total} 页`, "正在分块"][stage]

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
        <StatusTracker activeIndex={stage} progress={stage === 1 ? done / total : 0} stages={STAGES} />
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
