import { FileText } from "lucide-react"

import type { ConvertOptions, OcrMode } from "@/lib/api"
import { formatFileBytes, HaloDropzone } from "@/components/ui/halo-dropzone"
import { HaloProgress } from "@/components/ui/halo-progress"
import { HaloSegmented } from "@/components/ui/halo-segmented"
import { HaloSwitch } from "@/components/ui/halo-switch"

interface LandingProps {
  options: ConvertOptions
  onOptions: (o: ConvertOptions) => void
  onFile: (file: File) => void
  pending: { file: File; done: number; total: number; seconds: number } | null
}

const OCR_ITEMS = [
  { value: "auto", label: "自动 OCR" },
  { value: "force", label: "全部 OCR" },
  { value: "off", label: "关闭 OCR" },
]

const DPI_ITEMS = [
  { value: "150", label: "150 dpi" },
  { value: "200", label: "200 dpi" },
  { value: "300", label: "300 dpi" },
]

export function Landing({ options, onOptions, onFile, pending }: LandingProps) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 px-6 py-16">
      <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
        PDF <span className="text-muted-foreground">→</span> FastGPT 知识库
      </h1>

      <div className="w-full max-w-xl">
        {pending ? (
          <Converting {...pending} />
        ) : (
          <HaloDropzone
            accept="application/pdf,.pdf"
            emptyLabel="拖入 PDF 或点击选择"
            formatHint={null}
            onFiles={(files) => files[0] && onFile(files[0])}
            showSuccessThumbnails={false}
            successLabel="正在上传"
          />
        )}
      </div>

      <div
        className="flex flex-wrap items-center justify-center gap-3 data-[busy=true]:pointer-events-none data-[busy=true]:opacity-40"
        data-busy={!!pending}
      >
        <HaloSegmented
          items={OCR_ITEMS}
          onValueChange={(v) => onOptions({ ...options, ocr_mode: v as OcrMode })}
          value={options.ocr_mode}
        />
        {options.ocr_mode !== "off" && (
          <HaloSegmented
            items={DPI_ITEMS}
            onValueChange={(v) => onOptions({ ...options, ocr_dpi: Number(v) })}
            value={String(options.ocr_dpi)}
          />
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <HaloSwitch
            checked={options.remove_header_footer}
            onCheckedChange={(v) => onOptions({ ...options, remove_header_footer: v })}
            size="sm"
          />
          去页眉页脚
        </label>
      </div>
    </main>
  )
}

function Converting({ file, done, total, seconds }: { file: File; done: number; total: number; seconds: number }) {
  const pct = total ? Math.round((done / total) * 100) : null
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur">
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
  )
}
