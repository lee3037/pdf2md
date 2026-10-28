import { FileCode, FileText } from "lucide-react"

/** PDF 文件图标：沿用 PDF 常见的红色。 */
export function PdfIcon() {
  return <FileText aria-hidden className="size-4 shrink-0 text-red-500 dark:text-red-400" />
}

/** Markdown 文件图标：颜色跟随文件名文字。 */
export function MarkdownIcon() {
  return <FileCode aria-hidden className="size-4 shrink-0" />
}
