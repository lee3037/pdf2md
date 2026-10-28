import { DEFAULT_CHUNK } from "@/lib/api"

const KEY = "pdf2md.separators"

/** 分隔符下拉框的候选项：默认分隔符在前，后面是用户输入过的。 */
export function loadSeparators(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) || "[]")
    const custom = Array.isArray(saved) ? saved.filter((s): s is string => typeof s === "string") : []
    return [...new Set([DEFAULT_CHUNK.separator, ...custom])]
  } catch {
    return [DEFAULT_CHUNK.separator]
  }
}

/** 记住一个新分隔符，返回更新后的候选项。 */
export function addSeparator(separator: string): string[] {
  const list = [...new Set([...loadSeparators(), separator])]
  localStorage.setItem(KEY, JSON.stringify(list))
  return list
}
