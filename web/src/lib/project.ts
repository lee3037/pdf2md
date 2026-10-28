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
  /** 已有对应的 Markdown 产物 */
  converted: boolean
}

export interface MarkdownFile {
  path: string
  pdfPath: string
  version: number
}

export interface Project {
  id: string
  name: string
  /** false：只读打开（不支持写回的浏览器），结果需下载 */
  writable: boolean
  files: ProjectFile[]
  artifacts: MarkdownFile[]
  handle?: FileSystemDirectoryHandle
  /** 只读模式下按路径保存选中的文件 */
  snapshot?: Map<string, File>
}

const MAX_DEPTH = 4
const SKIP_DIR = /^(\.|node_modules$|__pycache__$)/
const isPdfName = (n: string) => /\.pdf$/i.test(n)
export const mdName = (pdf: string, version: number) => `${pdf.replace(/\.pdf$/i, "")}_v${version}.md`
const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path, "zh-CN", { numeric: true })

// ---------------------------------------------------------------- 扫描

interface ScannedFile { path: string; size: number }

/** 同时识别带版本号的新产物和原有的无后缀 Markdown。 */
function indexFiles(entries: ScannedFile[]) {
  const pdfs = entries.filter((file) => isPdfName(file.path))
  const pdfPaths = new Map(pdfs.map((file) => [file.path.toLowerCase(), file.path]))
  const artifacts = entries.filter((file) => /\.md$/i.test(file.path)).flatMap(({ path }) => {
    const stem = path.replace(/\.md$/i, "")
    const legacyPdf = pdfPaths.get(`${stem}.pdf`.toLowerCase())
    const versionMatch = legacyPdf ? null : stem.match(/^(.*)_v([1-9]\d*)$/i)
    // 无对应 PDF 的普通文档（如 README.md）不属于解析产物。
    if (!legacyPdf && !versionMatch) return []
    const source = `${versionMatch?.[1] ?? stem}.pdf`
    return [{
      path,
      pdfPath: legacyPdf ?? pdfPaths.get(source.toLowerCase()) ?? source,
      version: versionMatch ? Number(versionMatch[2]) : 1,
    }]
  }).sort(byPath)
  const converted = new Set(artifacts.map((artifact) => artifact.pdfPath))
  const files = pdfs.map((file) => ({ ...file, converted: converted.has(file.path) })).sort(byPath)
  return { files, artifacts }
}

async function scanHandle(dir: DirHandle, prefix = "", depth = 0): Promise<ScannedFile[]> {
  const files: ScannedFile[] = []
  const nested: Promise<ScannedFile[]>[] = []
  for await (const entry of dir.values()) {
    if (entry.kind === "file" && /\.(pdf|md)$/i.test(entry.name)) {
      files.push({ path: prefix + entry.name, size: (await entry.getFile()).size })
    } else if (entry.kind === "directory" && depth < MAX_DEPTH && !SKIP_DIR.test(entry.name)) {
      nested.push(scanHandle(entry as DirHandle, `${prefix}${entry.name}/`, depth + 1))
    }
  }
  return [...files, ...(await Promise.all(nested)).flat()]
}

function scanSnapshot(files: File[]) {
  const snapshot = new Map<string, File>()
  for (const file of files) {
    // webkitRelativePath 的首段是所选目录名。
    const path = file.webkitRelativePath.split("/").slice(1).join("/") || file.name
    if (/\.(pdf|md)$/i.test(path) && path.split("/").length <= MAX_DEPTH + 1 && !path.split("/").some((s) => SKIP_DIR.test(s))) {
      snapshot.set(path, file)
    }
  }
  const entries = [...snapshot].map(([path, file]) => ({ path, size: file.size }))
  return { snapshot, ...indexFiles(entries) }
}

/** 按目录和当前会话中已有的最大版本号递增，保留编号空缺。 */
export function nextMarkdownFile(pdfPath: string, artifacts: MarkdownFile[]): MarkdownFile {
  const versions = artifacts.filter((file) => file.pdfPath.toLowerCase() === pdfPath.toLowerCase()).map((file) => file.version)
  const version = Math.max(0, ...versions) + 1
  return { path: mdName(pdfPath, version), pdfPath, version }
}

// ---------------------------------------------------------------- 打开

async function ensurePermission(handle: FileSystemDirectoryHandle, ask: boolean) {
  const h = handle as DirHandle
  const mode = { mode: "readwrite" } as const
  if ((await h.queryPermission(mode)) === "granted") return true
  return ask && (await h.requestPermission(mode)) === "granted"
}

async function fromHandle(handle: FileSystemDirectoryHandle, id: string): Promise<Project> {
  const inventory = indexFiles(await scanHandle(handle as DirHandle))
  return { id, name: handle.name, writable: true, ...inventory, handle }
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
  if (project.handle) return { ...project, ...indexFiles(await scanHandle(project.handle as DirHandle)) }
  return project
}

// ---------------------------------------------------------------- 读写

async function walk(project: Project, path: string) {
  const parts = path.split("/")
  let dir = project.handle!
  for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg)
  return { dir, name: parts[parts.length - 1] }
}

async function readProjectFile(project: Project, path: string): Promise<File> {
  if (project.snapshot) {
    const f = project.snapshot.get(path)
    if (!f) throw new Error(`找不到 ${path}`)
    return f
  }
  const { dir, name } = await walk(project, path)
  return (await dir.getFileHandle(name)).getFile()
}

export const readPdf = readProjectFile

/** 按产物的实际路径读取 Markdown。 */
export async function readMarkdown(project: Project, path: string): Promise<string> {
  return (await readProjectFile(project, path)).text()
}

/** 将所选 PDF 复制到项目根目录，再扫描目录更新文件列表。 */
export async function addPdfToProject(project: Project, file: File): Promise<Project> {
  if (!project.writable || !project.handle) throw new Error("当前项目为只读，无法添加 PDF")
  if (!(await ensurePermission(project.handle, true))) throw new Error("没有目录写入权限")
  const root = project.handle as DirHandle
  for await (const entry of root.values()) {
    if (entry.name.toLowerCase() === file.name.toLowerCase()) {
      throw new Error(`项目目录中已存在 ${file.name}`)
    }
  }
  const handle = await root.getFileHandle(file.name, { create: true })
  const writer = await handle.createWritable()
  await writer.write(file)
  await writer.close()
  return rescan(project)
}

/** 新产物禁止覆盖同名文件；已保存产物的手动编辑由调用方明确允许覆盖。 */
export async function writeMarkdown(project: Project, path: string, markdown: string, overwrite = false) {
  if (!(await ensurePermission(project.handle!, true))) throw new Error("没有目录写入权限")
  const { dir, name } = await walk(project, path)
  if (!overwrite) {
    for await (const entry of (dir as DirHandle).values()) {
      if (entry.name.toLowerCase() === name.toLowerCase()) {
        throw new Error(`${path} 已存在，请重新生成一个新版本`)
      }
    }
  }
  const fh = await dir.getFileHandle(name, { create: true })
  const writer = await fh.createWritable()
  await writer.write(markdown)
  await writer.close()
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
