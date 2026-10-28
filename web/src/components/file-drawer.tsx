import { useState, type ReactNode } from "react"
import { Eye, Layers, X } from "lucide-react"
import { motion } from "motion/react"
import useMeasure from "react-use-measure"
import { Drawer } from "vaul"

import type { ChunkOptions, ConvertOptions } from "@/lib/api"
import type { ParserCatalog } from "@/lib/use-parsers"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { SettingsPanel } from "@/components/settings-panel"

/** 一次解析使用的全部参数 */
export interface ParseSettings {
  convert: ConvertOptions
  chunk: ChunkOptions
}

export type FileDrawerView = "menu" | "config"

interface FileDrawerProps {
  /** 项目内的 PDF 相对路径 */
  path: string
  open: boolean
  initialView: FileDrawerView
  /** 当前设置；进入配置页时复制一份，确认后才生效 */
  settings: ParseSettings
  catalog: ParserCatalog
  onParse: (settings: ParseSettings) => void
  onPreview: () => void
  onClose: () => void
  reparse?: boolean
}

const TONES = {
  sky: "bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-900/20 dark:text-sky-300 dark:hover:bg-sky-900/30",
  neutral:
    "bg-neutral-100 text-neutral-900 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700",
  red: "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30",
}

function Action({ tone, icon, onClick, children }: { tone: keyof typeof TONES; icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className={cn("flex w-full items-center gap-2 rounded-2xl px-4 py-3.5 font-medium transition-colors [&_svg]:size-5", TONES[tone])}
      onClick={onClick}
      type="button"
    >
      {icon}
      {children}
    </button>
  )
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Drawer.Title className="min-w-0 truncate text-lg font-medium text-neutral-900 dark:text-neutral-100" title={title}>
        {title}
      </Drawer.Title>
      <Button
        aria-label="关闭"
        className="shrink-0 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800"
        onClick={onClose}
        size="icon"
        variant="secondary"
      >
        <X className="text-neutral-600 dark:text-neutral-400" size={18} />
      </Button>
    </div>
  )
}

/**
 * 点选 PDF 后弹出的底部抽屉：先选操作，再确认本次解析配置。
 * 改写自 Spectrum UI 的 Animated Drawer：切换内容时高度跟随实际内容平滑变化。
 */
export function FileDrawer({ path, open, initialView, settings, catalog, onParse, onPreview, onClose, reparse = false }: FileDrawerProps) {
  const [view, setView] = useState(initialView)
  const [draft, setDraft] = useState(settings)
  const { chunk, convert } = draft
  const parser = catalog.parsers.find((p) => p.id === convert.parser)
  const valid = !!parser && !!chunk.separator.trim() &&
    Number.isInteger(chunk.min_chars) && chunk.min_chars >= 0 && chunk.min_chars <= chunk.max_chars &&
    Number.isInteger(chunk.max_chars) && chunk.max_chars >= 100 && chunk.max_chars <= 10000 &&
    Number.isInteger(chunk.table_max_rows) && chunk.table_max_rows >= 0 && chunk.table_max_rows <= 500 &&
    (!parser.local_ocr_options || (
      ["auto", "force", "off"].includes(convert.ocr_mode) &&
      Number.isInteger(convert.ocr_dpi) && convert.ocr_dpi >= 100 && convert.ocr_dpi <= 300
    ))
  const [contentRef, bounds] = useMeasure()
  const name = path.split("/").pop() ?? path

  return (
    // 配置页里有步进器和开关，拖动手势会和它们冲突，只在操作菜单上允许下拉关闭
    <Drawer.Root handleOnly={view === "config"} onOpenChange={(v) => !v && onClose()} open={open}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content
          aria-describedby={undefined}
          asChild
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-[400px] overflow-hidden rounded-[36px] bg-white outline-hidden dark:bg-neutral-900"
          onEscapeKeyDown={(event) => {
            // Base UI 的候选列表先处理 Escape，避免同一次按键也关闭 Vaul 抽屉。
            if (event.target instanceof HTMLElement &&
              event.target.closest('[role="dialog"]')?.querySelector('[role="combobox"][aria-expanded="true"]')) {
              event.preventDefault()
            }
          }}
        >
          <motion.div animate={{ height: bounds.height || "auto" }}>
            <div className={view === "config" ? "p-4" : "p-6"} ref={contentRef}>
              {view === "menu" ? (
                <>
                  <Header onClose={onClose} title={name} />
                  <div className="mt-6 flex flex-col gap-4">
                    <Action icon={<Layers />} onClick={() => setView("config")} tone="sky">
                      开始解析分块
                    </Action>
                    <Action icon={<Eye />} onClick={onPreview} tone="neutral">
                      预览原文件
                    </Action>
                    <Action icon={<X />} onClick={onClose} tone="red">
                      取消
                    </Action>
                  </div>
                </>
              ) : (
                <>
                  <div className="px-1 pt-1 pb-4">
                    <Header onClose={onClose} title="解析配置" />
                  </div>
                  <div className="max-h-[min(60svh,530px,calc(100svh-172px))] overflow-y-auto overscroll-contain px-[3px] py-1 [scrollbar-width:thin]">
                    <SettingsPanel
                      catalog={catalog}
                      convert={draft.convert}
                      onChange={(chunk) => setDraft((d) => ({ ...d, chunk }))}
                      onConvert={(convert) => setDraft((d) => ({ ...d, convert }))}
                      value={draft.chunk}
                    />
                  </div>
                  <div className="mt-4 flex items-center gap-2.5 px-[3px]">
                    <Button
                      className="h-10 w-[35%] rounded-3xl bg-neutral-100 text-neutral-900 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
                      onClick={() => (initialView === "config" ? onClose() : setView("menu"))}
                    >
                      {initialView === "config" ? "取消" : "返回"}
                    </Button>
                    <Button
                      className="h-10 min-w-0 flex-1 rounded-3xl bg-sky-500 text-white hover:bg-sky-600"
                      disabled={!valid}
                      onClick={() => onParse(draft)}
                    >
                      <Layers />
                      {reparse ? "重新解析分块" : "开始解析"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
