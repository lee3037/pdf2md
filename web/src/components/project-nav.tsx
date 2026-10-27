import { useMemo, useRef } from "react"
import { FilePlus2, RefreshCw } from "lucide-react"

import type { Project } from "@/lib/project"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"
import { TreeNav } from "@/components/spectrumui/tree-nav"

interface ProjectNavProps {
  project: Project
  active: string | null
  /** 转换中：禁止切换文件 */
  locked: boolean
  onSelect: (path: string) => void
  onRefresh: () => void
  /** 打开目录外的 PDF */
  onFile: (file: File) => void
}

/** 左栏上半部分：项目目录中的全部 PDF。 */
export function ProjectNav({ project, active, locked, onSelect, onRefresh, onFile }: ProjectNavProps) {
  const pickRef = useRef<HTMLInputElement>(null)
  const items = useMemo(
    () =>
      project.files.map((f) => ({
        label: f.path,
        href: `#${encodeURIComponent(f.path)}`,
        badge: f.converted ? "已转换" : undefined,
      })),
    [project.files]
  )
  const converted = project.files.filter((f) => f.converted).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-0.5 py-3 pr-2 pl-5">
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          PDF {project.files.length}
          {converted > 0 && ` · 已转换 ${converted}`}
        </span>
        <Hint label="打开目录外的 PDF（也可直接拖入页面）">
          <Button
            aria-label="新文件"
            className="ml-auto"
            disabled={locked}
            onClick={() => pickRef.current?.click()}
            size="icon-sm"
            variant="ghost"
          >
            <FilePlus2 />
          </Button>
        </Hint>
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
        {project.writable && (
          <Hint label="重新扫描目录">
            <Button aria-label="重新扫描目录" onClick={onRefresh} size="icon-sm" variant="ghost">
              <RefreshCw />
            </Button>
          </Hint>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-3 pb-4 pl-2">
        {items.length ? (
          <TreeNav
            activeHref={active ? `#${encodeURIComponent(active)}` : undefined}
            className={locked ? "pointer-events-none opacity-60" : undefined}
            items={items}
            onSelect={(item, e) => {
              e.preventDefault()
              onSelect(item.label)
            }}
          />
        ) : (
          <p className="px-3 py-2 text-sm text-muted-foreground">目录中没有 PDF 文件</p>
        )}
      </div>
    </div>
  )
}
