import { useMemo } from "react"
import { RefreshCw } from "lucide-react"

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
}

/** 左侧文件导航：项目目录中的全部 PDF。 */
export function ProjectNav({ project, active, locked, onSelect, onRefresh }: ProjectNavProps) {
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
    <aside className="flex min-h-0 flex-col border-border/60 border-r">
      <div className="flex items-center gap-2 py-3 pr-2 pl-5">
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          PDF {project.files.length}
          {converted > 0 && ` · 已转换 ${converted}`}
        </span>
        {project.writable && (
          <Hint label="重新扫描目录">
            <Button aria-label="重新扫描目录" className="ml-auto" onClick={onRefresh} size="icon-sm" variant="ghost">
              <RefreshCw />
            </Button>
          </Hint>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-3 pb-6 pl-2">
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
    </aside>
  )
}
