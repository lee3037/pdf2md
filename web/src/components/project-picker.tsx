import { useEffect, useRef, useState } from "react"

import type { Project, RecentProject } from "@/lib/project"
import { canWriteBack, forgetRecent, fromFileList, loadRecents, openRecent, pickDirectory } from "@/lib/project"
import { Logo } from "@/components/logo"
import { SplitTextReveal } from "@/components/motion/split-text-reveal"
import { EmptyAction, IconDelete, IconFolder } from "@/components/spectrumui/blocks/empty-states/empty-state-kit"
import { ProjectEmpty } from "@/components/spectrumui/blocks/empty-states/project-empty"
import { toast } from "@/components/toaster"

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return "刚刚"
  if (m < 60) return `${m} 分钟前`
  if (m < 60 * 24) return `${Math.round(m / 60)} 小时前`
  return `${Math.round(m / 60 / 24)} 天前`
}

/** 首页：选择本机目录作为项目，或重新打开最近的项目。 */
export function ProjectPicker({ onOpen }: { onOpen: (p: Project) => void }) {
  const writable = canWriteBack()
  const [recents, setRecents] = useState<RecentProject[]>([])
  const [chineseName, setChineseName] = useState(false)
  const busy = useRef(false)
  const folderRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadRecents().then(setRecents)
  }, [])

  const run = async (task: () => Promise<Project | null>) => {
    if (busy.current) return
    busy.current = true
    try {
      const p = await task()
      if (p) onOpen(p)
    } catch (e) {
      toast({ title: "无法打开目录", description: e instanceof Error ? e.message : String(e), status: "error" })
    } finally {
      busy.current = false
    }
  }

  const open = (id: string | null) => {
    const recent = id ? recents.find((r) => r.id === id) : undefined
    if (recent) return run(() => openRecent(recent))
    if (writable) return run(pickDirectory)
    folderRef.current?.click()
  }

  const forget = async (id: string) => {
    await forgetRecent(id)
    setRecents((rs) => rs.filter((r) => r.id !== id))
  }

  return (
    <div className="flex min-h-svh flex-col items-center bg-muted/30 px-4 pt-14 pb-10">
      <h1>
        {/* 点击品牌名在中英文之间切换，每次切换重播逐字飞入 */}
        <button
          className="group flex cursor-pointer select-none flex-col items-center gap-4"
          onClick={() => setChineseName((v) => !v)}
          type="button"
        >
          <Logo className="size-20" />
          <SplitTextReveal
            className="font-bold text-[40px] text-neutral-900 leading-none tracking-tight transition-transform duration-200 group-hover:scale-[1.02] dark:text-neutral-100"
            text={chineseName ? "层析" : "Stratum"}
          />
        </button>
      </h1>
      {/* 卡片在品牌区下方的剩余空间内垂直居中 */}
      <div className="flex w-full flex-1 items-center justify-center py-8">
        <ProjectEmpty
          // 列表增删后重置组件内的选中状态
          key={recents.map((r) => r.id).join()}
          chosenLabel={(t) => `打开「${t.name}」`}
          className="max-w-[680px]"
          createLabel="选择目录"
          description="项目就是本机的一个文件夹。打开后可以逐个把其中的 PDF 转换为分块 Markdown，结果保存在 PDF 旁边。"
          footnote={
            writable
              ? "PDF 会上传到服务端解析；双击最近项目可直接打开。"
              : "当前浏览器无法写回目录（需 Chrome / Edge，并通过 HTTPS 或 localhost 访问），将以只读方式打开，结果需手动下载。"
          }
          meta={recents.length ? `最近 ${recents.length} 个项目` : "本机目录"}
          onActivate={open}
          onCreate={open}
          panelTitle="项目"
          secondaryAction={(id) =>
            id ? (
              <EmptyAction emphasis="quiet" icon={<IconDelete />} onClick={() => forget(id)}>
                从列表移除
              </EmptyAction>
            ) : null
          }
          templates={recents.map((r) => ({
            id: r.id,
            name: r.name,
            detail: `${r.pdfs} 个 PDF · ${ago(r.openedAt)}`,
            icon: <IconFolder />,
          }))}
          title={recents.length ? "选择一个项目" : "还没有项目"}
          toolbarLabel="选择目录"
          variant={recents.length ? "Templates" : "Minimal"}
        />
      </div>
      <input
        className="hidden"
        multiple
        onChange={(e) => {
          const p = e.target.files && fromFileList(e.target.files)
          e.target.value = ""
          if (p) onOpen(p)
        }}
        ref={(el) => {
          folderRef.current = el
          el?.setAttribute("webkitdirectory", "")
        }}
        type="file"
      />
    </div>
  )
}
