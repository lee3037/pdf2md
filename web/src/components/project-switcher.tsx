import { useRef, useState } from "react"
import { Check, ChevronsUpDown, FolderOpen, FolderPlus } from "lucide-react"

import type { Project, RecentProject } from "@/lib/project"
import { canWriteBack, fromFileList, loadRecents, openRecent, pickDirectory } from "@/lib/project"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface ProjectSwitcherProps {
  project: Project
  /** 打开另一个项目；task 返回 null 表示用户取消了目录选择 */
  onSwitch: (task: () => Promise<Project | null>) => void
}

/** 页头的项目名：下拉列出最近项目，点选即切换，不经过首页。 */
export function ProjectSwitcher({ project, onSwitch }: ProjectSwitcherProps) {
  const [recents, setRecents] = useState<RecentProject[]>([])
  const folderRef = useRef<HTMLInputElement>(null)

  const openOther = () => {
    if (canWriteBack()) onSwitch(pickDirectory)
    else folderRef.current?.click()
  }

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && loadRecents().then(setRecents)}>
        <DropdownMenuTrigger render={<Button className="max-w-56 gap-2 px-2" variant="ghost" />}>
          <FolderOpen />
          <span className="truncate">{project.name}</span>
          {!project.writable && <Badge variant="outline">只读</Badge>}
          <ChevronsUpDown className="text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          {recents.map((r) => {
            const current = r.id === project.id
            return (
              <DropdownMenuItem
                key={r.id}
                onClick={() => !current && onSwitch(() => openRecent(r))}
              >
                <FolderOpen className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                {current && <Check />}
              </DropdownMenuItem>
            )
          })}
          {recents.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={openOther}>
            <FolderPlus className="text-muted-foreground" />
            打开其他目录…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        className="hidden"
        multiple
        onChange={(e) => {
          const p = e.target.files && fromFileList(e.target.files)
          e.target.value = ""
          if (p) onSwitch(async () => p)
        }}
        ref={(el) => {
          folderRef.current = el
          el?.setAttribute("webkitdirectory", "")
        }}
        type="file"
      />
    </>
  )
}
