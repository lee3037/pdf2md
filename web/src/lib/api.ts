export type OcrMode = "auto" | "force" | "off"
export type ContextMode = "breadcrumb" | "headings" | "none"
export type TableMode = "markdown" | "kv"

export interface ConvertOptions {
  ocr_mode: OcrMode
  ocr_dpi: number
  remove_header_footer: boolean
}

export interface ChunkOptions {
  separator: string
  max_chars: number
  min_chars: number
  context: ContextMode
  include_pages: boolean
  table_mode: TableMode
  table_max_rows: number
}

export interface DocStats {
  pages: number
  ocr_pages: number
  headings: number
  tables: number
  tables_merged: number
  paragraphs_merged: number
  removed_header_footer: number
}

export interface ConvertResult {
  markdown: string
  chunks: { index: number; chars: number; pages: number[] | null; path: string[] }[]
  stats: { chunks: number; avg_chars: number; max_chars: number; min_chars: number }
  doc_stats: DocStats
  warnings: string[]
}

export interface Job {
  id: string
  filename: string
  status: "queued" | "running" | "done" | "error"
  progress: { done: number; total: number }
  error?: string
  elapsed?: number
  page_count: number
  result?: ConvertResult
}

export const DEFAULT_CONVERT: ConvertOptions = { ocr_mode: "auto", ocr_dpi: 200, remove_header_footer: true }

export const DEFAULT_CHUNK: ChunkOptions = {
  separator: "===CHUNK===",
  max_chars: 1000,
  min_chars: 200,
  context: "breadcrumb",
  include_pages: true,
  table_mode: "markdown",
  table_max_rows: 0,
}

async function json<T>(resp: Response): Promise<T> {
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error((data as { detail?: string }).detail || resp.statusText)
  }
  return data as T
}

export async function createJob(file: File, options: ConvertOptions & ChunkOptions) {
  const fd = new FormData()
  fd.append("file", file)
  fd.append("options", JSON.stringify(options))
  return json<{ id: string; page_count: number }>(await fetch("api/jobs", { method: "POST", body: fd }))
}

export async function getJob(id: string) {
  return json<Job>(await fetch(`api/jobs/${id}`))
}

export async function rechunk(id: string, options: ChunkOptions) {
  return json<ConvertResult>(
    await fetch(`api/jobs/${id}/rechunk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options }),
    })
  )
}

export const pdfUrl = (id: string, page?: number | null) => `api/jobs/${id}/pdf${page ? `#page=${page}` : ""}`
