import { useEffect, useState } from "react"
import { Check, Copy, Download, LoaderCircle, RotateCcw, Save, X } from "lucide-react"

import { ExpandableActionBar, type ExpandableActionBarItem } from "@/components/motion/expandable-action-bar"
import type { MorphButtonState } from "@/components/spectrumui/morph-button"
import { copyToClipboardWithMeta } from "@/components/ui/copy-button"
import { toast } from "@/components/toaster"

interface ResultActionsProps {
  markdown: string
  writable: boolean
  busy: boolean
  saveState: MorphButtonState
  onDownload: () => void
  onSave: () => void
  onReparse: () => void
}

const SAVE_LABELS = { idle: "保存到目录", loading: "保存中", success: "已保存", error: "保存失败" }
const SAVE_ICONS = { idle: Save, loading: LoaderCircle, success: Check, error: X }

export function ResultActions({ markdown, writable, busy, saveState, onDownload, onSave, onReparse }: ResultActionsProps) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    if (await copyToClipboardWithMeta(markdown)) setCopied(true)
    else toast({ title: "复制失败", status: "error" })
  }
  const SaveIcon = SAVE_ICONS[saveState]
  const items: ExpandableActionBarItem[] = [
    { id: "copy", label: copied ? "已复制" : "复制 Markdown", icon: copied ? <Check /> : <Copy />, disabled: busy, onClick: copy },
    { id: "download", label: "下载 .md", icon: <Download />, disabled: busy, onClick: onDownload },
    ...(writable ? [{
      id: "save", label: SAVE_LABELS[saveState],
      icon: <SaveIcon className={saveState === "loading" ? "animate-spin" : undefined} />,
      disabled: busy || saveState !== "idle", onClick: onSave,
    }] : []),
    { id: "reparse", label: busy ? "处理中" : "重新解析分块", icon: <RotateCcw className={busy ? "animate-spin" : undefined} />, disabled: busy || saveState === "loading", onClick: onReparse },
  ]

  return (
    <div aria-label="Markdown 产物操作" className="min-w-0 max-w-full" role="group">
      <ExpandableActionBar
        className="flex"
        classNames={{ track: "h-9 p-0.5 shadow-xs", icon: "[&_svg]:size-3.5" }}
        items={items}
        size="sm"
      />
      <span aria-live="polite" className="sr-only">{copied ? "已复制" : saveState !== "idle" ? SAVE_LABELS[saveState] : ""}</span>
    </div>
  )
}
