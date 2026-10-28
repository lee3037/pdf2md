import { useCallback, useEffect, useState } from "react"

import { DEFAULT_PARSER, getParsers, type ParserInfo } from "@/lib/api"

export interface ParserCatalog {
  /** 加载完成前只有默认方案 */
  parsers: ParserInfo[]
  failed: boolean
  reload: () => void
}

/** 从后端读取可用的解析方案目录。 */
export function useParsers(): ParserCatalog {
  const [parsers, setParsers] = useState<ParserInfo[] | null>(null)
  const [failed, setFailed] = useState(false)
  const reload = useCallback(() => {
    getParsers().then(
      (list) => {
        setParsers(list)
        setFailed(false)
      },
      () => setFailed(true),
    )
  }, [])
  useEffect(reload, [reload])
  return { parsers: parsers ?? [DEFAULT_PARSER], failed, reload }
}
