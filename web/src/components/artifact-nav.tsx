import type { MarkdownFile, Project } from "@/lib/project"
import { MarkdownIcon } from "@/components/file-type-icon"
import { TreeNav } from "@/components/spectrumui/tree-nav"

export interface ArtifactNavItem extends MarkdownFile {
  unsaved?: boolean
}

interface ArtifactNavProps {
  project: Project
  artifacts: ArtifactNavItem[]
  currentPath: string | null
  locked: boolean
  onSelect: (path: string) => void
}

/** 合并目录中的产物与本次会话生成的版本，按实际 Markdown 路径导航。 */
export function ArtifactNav({ project, artifacts, currentPath, locked, onSelect }: ArtifactNavProps) {
  const byPath = new Map<string, ArtifactNavItem>(project.artifacts.map((file) => [file.path, file]))
  for (const artifact of artifacts) byPath.set(artifact.path, artifact)
  const items = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path, "zh-CN", { numeric: true }))
  const href = (path: string) => `#md:${encodeURIComponent(path)}`

  return (
    <nav aria-label="Markdown 产物" className="flex min-h-0 flex-1 flex-col border-border/60 border-t">
      <div className="px-5 py-4 text-sm font-medium text-muted-foreground tabular-nums">Markdown {items.length}</div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-3 pb-4 pl-2" inert={locked}>
        {items.length ? (
          <TreeNav
            activeHref={currentPath ? href(currentPath) : undefined}
            className={locked ? "opacity-60" : undefined}
            items={items.map((artifact) => ({
              label: artifact.path,
              href: href(artifact.path),
              icon: <MarkdownIcon />,
              badge: artifact.unsaved ? "未保存" : undefined,
            }))}
            onSelect={(item, event) => {
              event.preventDefault()
              onSelect(decodeURIComponent(item.href.slice(4)))
            }}
          />
        ) : (
          <p className="px-3 py-2 text-sm text-muted-foreground">暂无 Markdown 产物</p>
        )}
      </div>
    </nav>
  )
}
