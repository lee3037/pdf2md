import { cn } from "@/lib/utils"

/**
 * Stratum 层析的标志：逐级缩进的三条横条，表示从 PDF 中析出的标题层级。
 * 与 public/favicon.svg 是同一图形，修改时两处保持一致。
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={cn("size-6 shrink-0", className)} fill="none" viewBox="0 0 32 32">
      <rect fill="#171717" height="32" rx="8" width="32" />
      <rect fill="#6366f1" height="4" rx="2" width="18" x="7" y="8" />
      <rect fill="#fff" height="4" rx="2" width="14.5" x="10.5" y="14" />
      <rect fill="#fff" fillOpacity=".55" height="4" rx="2" width="11" x="14" y="20" />
    </svg>
  )
}
