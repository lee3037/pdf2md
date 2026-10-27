import { FileText } from "lucide-react"

import { formatFileBytes, HaloDropzone } from "@/components/ui/halo-dropzone"
import { HaloProgress } from "@/components/ui/halo-progress"

export interface Pending {
  file: File
  /** 项目内的相对路径 */
  path?: string
  done: number
  total: number
  seconds: number
}

/** 未加载文档时的主区域：拖拽上传。 */
export function EmptyStage({ label, onFile }: { label: string; onFile: (file: File) => void }) {
  return (
    <div className="flex h-full items-center justify-center px-6 pb-16">
      <div className="w-full max-w-xl" data-dropzone>
        <HaloDropzone
          accept="application/pdf,.pdf"
          emptyLabel={label}
          formatHint={null}
          onFiles={(files) => files[0] && onFile(files[0])}
          showSuccessThumbnails={false}
          successLabel="正在上传"
        />
      </div>
    </div>
  )
}

/** 转换中的主区域：文件与页进度。 */
export function ConvertingStage({ file, done, total, seconds }: Pending) {
  const pct = total ? Math.round((done / total) * 100) : null
  return (
    <div className="flex h-full items-center justify-center px-6 pb-16">
      <div className="flex w-full max-w-xl flex-col gap-4 rounded-3xl border border-border/70 bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <FileText className="size-8 shrink-0 text-muted-foreground" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{file.name}</div>
            <div className="text-sm text-muted-foreground tabular-nums">
              {formatFileBytes(file.size)}
              {total ? ` · ${done} / ${total} 页` : ""} · {seconds}s
            </div>
          </div>
        </div>
        <HaloProgress value={pct === 0 ? null : pct} />
      </div>
    </div>
  )
}
