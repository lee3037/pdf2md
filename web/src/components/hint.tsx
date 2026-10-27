import type { ReactElement, ReactNode } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** 悬停提示：包裹一个按钮（或任意可交互元素），鼠标停留时显示说明。 */
export function Hint({
  label,
  side = "bottom",
  children,
}: {
  label: ReactNode
  side?: "top" | "bottom" | "left" | "right"
  children: ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}

/** 提示里的快捷键样式。 */
export function Keys({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-background/25 px-1 font-sans text-[10px] text-background/75" data-slot="kbd">
      {children}
    </kbd>
  )
}
