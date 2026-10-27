/** 项目 = 浏览器本机的一个目录：列出其中的 PDF，把转换结果 .md 写回 PDF 旁边。 */

// File System Access API 尚未进入 TS 的 DOM 类型
type PermissionMode = { mode: "read" | "readwrite" }
interface DirHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>
  queryPermission(d: PermissionMode): Promise<PermissionState>
  requestPermission(d: PermissionMode): Promise<PermissionState>
}
declare global {
  interface Window {
    showDirectoryPicker?: (o?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>
  }
}

/** 可写回目录需要 Chromium 内核且页面处于安全上下文（HTTPS 或 localhost）。 */
export const canWriteBack = () => typeof window.showDirectoryPicker === "function" && window.isSecureContext

export interface ProjectFile {
  /** 相对项目根目录的路径，如 `合同/2024/a.pdf` */
  path: string
  size: number
  /** 同目录下已有同名 .md */
  converted: boolean
}

export interface Project {
  id: string
  name: string
  /** false：只读打开（不支持写回的浏览器），结果需下载 */
  writable: boolean
  files: ProjectFile[]
  handle?: FileSystemDirectoryHandle
  /** 只读模式下按路径保存选中的文件 */
  snapshot?: Map<string, File>
}

const MAX_DEPTH = 4
const SKIP_DIR = /^(\.|node_modules$|__pycache__$)/
const isPdfName = (n: string) => /\.pdf$/i.test(n)
export const mdName = (pdf: string) => pdf.replace(/\.pdf$/i, "") + ".md"
const byPath = (a: ProjectFile, b: ProjectFile) => a.path.localeCompare(b.path, "zh-CN", { numeric: true })

// ---------------------------------------------------------------- 扫描

async function scanHandle(dir: DirHandle, prefix = "", depth = 0): Promise<ProjectFile[]> {
  const pdfs: FileSystemFileHandle[] = []
  const names = new Set<string>()
  const nested: Promise<ProjectFile[]>[] = []
  for await (const entry of dir.values()) {
    if (entry.kind === "file") {
      names.add(entry.name.toLowerCase())
      if (isPdfName(entry.name)) pdfs.push(entry)
    } else if (depth < MAX_DEPTH && !SKIP_DIR.test(entry.name)) {
      nested.push(scanHandle(entry as DirHandle, `${prefix}${entry.name}/`, depth + 1))
    }
  }
  const own = await Promise.all(
    pdfs.map(async (h) => ({
      path: prefix + h.name,
      size: (await h.getFile()).size,
      converted: names.has(mdName(h.name).toLowerCase()),
    }))
  )
  return [...own, ...(await Promise.all(nested)).flat()]
}

function scanSnapshot(files: File[]) {
  // webkitRelativePath 以所选目录名开头，去掉它
  const rel = (f: File) => f.webkitRelativePath.split("/").slice(1).join("/") || f.name
  const all = new Set(files.map((f) => rel(f).toLowerCase()))
  const snapshot = new Map<string, File>()
  for (const f of files) {
    const path = rel(f)
    if (isPdfName(path) && path.split("/").length <= MAX_DEPTH + 1 && !path.split("/").some((s) => SKIP_DIR.test(s)))
      snapshot.set(path, f)
  }
  const list = [...snapshot].map(([path, f]) => ({ path, size: f.size, converted: all.has(mdName(path).toLowerCase()) }))
  return { snapshot, files: list.sort(byPath) }
}

// ---------------------------------------------------------------- 打开

async function ensurePermission(handle: FileSystemDirectoryHandle, ask: boolean) {
  const h = handle as DirHandle
  const mode = { mode: "readwrite" } as const
  if ((await h.queryPermission(mode)) === "granted") return true
  return ask && (await h.requestPermission(mode)) === "granted"
}

async function fromHandle(handle: FileSystemDirectoryHandle, id: string): Promise<Project> {
  const files = (await scanHandle(handle as DirHandle)).sort(byPath)
  return { id, name: handle.name, writable: true, files, handle }
}

/** 弹出系统目录选择框。用户取消时返回 null。 */
export async function pickDirectory(): Promise<Project | null> {
  try {
    const handle = await window.showDirectoryPicker!({ id: "pdf2md", mode: "readwrite" })
    const recents = await loadRecents()
    // 同一目录再次选择时复用原记录
    let id: string | null = null
    for (const r of recents) if (await r.handle.isSameEntry(handle)) id = r.id
    const project = await fromHandle(handle, id ?? crypto.randomUUID())
    await remember(project)
    return project
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null
    throw e
  }
}

/** 只读兜底：`<input webkitdirectory>` 选到的文件列表。 */
export function fromFileList(list: FileList): Project | null {
  const files = Array.from(list)
  if (!files.length) return null
  const name = files[0].webkitRelativePath.split("/")[0] || "未命名目录"
  return { id: crypto.randomUUID(), name, writable: false, ...scanSnapshot(files) }
}

/** 重新打开最近项目；浏览器会在需要时再次请求授权。 */
export async function openRecent(recent: RecentProject): Promise<Project> {
  if (!(await ensurePermission(recent.handle, true))) throw new Error(`没有获得「${recent.name}」的读写授权`)
  const project = await fromHandle(recent.handle, recent.id)
  await remember(project)
  return project
}

export async function rescan(project: Project): Promise<Project> {
  if (project.handle) return { ...project, files: (await scanHandle(project.handle as DirHandle)).sort(byPath) }
  return project
}

// ---------------------------------------------------------------- 读写

async function walk(project: Project, path: string) {
  const parts = path.split("/")
  let dir = project.handle!
  for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg)
  return { dir, name: parts[parts.length - 1] }
}

export async function readPdf(project: Project, path: string): Promise<File> {
  if (project.snapshot) {
    const f = project.snapshot.get(path)
    if (!f) throw new Error(`找不到 ${path}`)
    return f
  }
  const { dir, name } = await walk(project, path)
  return (await dir.getFileHandle(name)).getFile()
}

/** 读取已有的同名 .md；不存在时返回 null。 */
export async function readMarkdown(project: Project, pdfPath: string): Promise<string | null> {
  if (!project.handle) return null
  try {
    const { dir, name } = await walk(project, pdfPath)
    return await (await (await dir.getFileHandle(mdName(name))).getFile()).text()
  } catch {
    return null
  }
}

/** 把 Markdown 写到 PDF 旁边（同名 .md，已存在则覆盖），返回写入的相对路径。 */
export async function writeMarkdown(project: Project, pdfPath: string, markdown: string) {
  if (!(await ensurePermission(project.handle!, true))) throw new Error("没有目录写入权限")
  const { dir, name } = await walk(project, pdfPath)
  const fh = await dir.getFileHandle(mdName(name), { create: true })
  const w = await fh.createWritable()
  await w.write(markdown)
  await w.close()
  return mdName(pdfPath)
}

// ---------------------------------------------------------------- 最近项目（IndexedDB，目录句柄可直接存）

export interface RecentProject {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
  pdfs: number
  openedAt: number
}

const DB = "pdf2md"
const STORE = "projects"
const MAX_RECENTS = 6

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "id" })
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const req = run(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => (resolve(req.result), db.close())
      req.onerror = () => (reject(req.error), db.close())
    }
  })
}

export async function loadRecents(): Promise<RecentProject[]> {
  if (!canWriteBack()) return []
  const all = await tx<RecentProject[]>("readonly", (s) => s.getAll()).catch(() => [])
  return all.sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX_RECENTS)
}

async function remember(project: Project) {
  const entry: RecentProject = {
    id: project.id,
    name: project.name,
    handle: project.handle!,
    pdfs: project.files.length,
    openedAt: Date.now(),
  }
  await tx("readwrite", (s) => s.put(entry))
  const extra = (await tx<RecentProject[]>("readonly", (s) => s.getAll()))
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(MAX_RECENTS)
  for (const r of extra) await forgetRecent(r.id)
}

export const forgetRecent = (id: string) => tx("readwrite", (s) => s.delete(id))
