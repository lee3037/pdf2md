import { useEffect, useState } from "react"

/** 带本地持久化的状态：刷新页面后保留用户上次的设置。 */
export function useStored<T extends object>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null")
      return saved ? { ...initial, ...saved } : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])
  return [value, setValue] as const
}
