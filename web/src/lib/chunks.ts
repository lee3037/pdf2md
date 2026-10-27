import { marked } from "marked"

export interface ChunkView {
  text: string
  chars: number
  page: number | null
  pages: string
  path: string
}

export function splitChunks(markdown: string, sep: string): string[] {
  return markdown
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function joinChunks(chunks: string[], sep: string): string {
  return chunks.map((c) => c.trim()).filter(Boolean).join(`\n\n${sep}\n\n`) + "\n"
}

/** 从块文本中读出页码与章节路径（编辑后依然有效）。 */
export function describeChunk(text: string): ChunkView {
  const pm = text.match(/页码：(\d+)(?:-(\d+))?/)
  const cm = text.match(/章节：(.+?)(?:\s*｜|\n|$)/)
  const hm = text.match(/^#{1,6}\s+(.+)$/m)
  return {
    text,
    chars: text.length,
    page: pm ? Number(pm[1]) : null,
    pages: pm ? (pm[2] ? `${pm[1]}–${pm[2]}` : pm[1]) : "",
    path: cm ? cm[1] : hm ? hm[1] : "",
  }
}

/** 去掉块首的“章节/页码”引用行，卡片头部已单独展示。 */
export function stripContext(text: string): string {
  return text.replace(/^>\s*(章节|页码)：.*\n+/, "")
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

marked.use({
  gfm: true,
  renderer: {
    // PDF 文本里的尖括号不能当作 HTML 执行
    html(token) {
      return escapeHtml(token.text)
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens)
      return /^(https?:|mailto:|#)/i.test(token.href)
        ? `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener">${text}</a>`
        : text
    },
    image(token) {
      return escapeHtml(token.text)
    },
  },
})

export const renderMarkdown = (md: string) => marked.parse(md, { async: false }) as string
