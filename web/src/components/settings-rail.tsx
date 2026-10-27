import type { ReactNode } from "react"
import { RefreshCw } from "lucide-react"

import type { ChunkOptions, ContextMode, TableMode } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { HaloInput } from "@/components/ui/halo-input"
import { HaloSegmented } from "@/components/ui/halo-segmented"
import { HaloSwitch } from "@/components/ui/halo-switch"

interface SettingsRailProps {
  value: ChunkOptions
  onChange: (o: ChunkOptions) => void
  /** 有手动编辑时参数改动不自动应用，显示覆盖按钮 */
  pendingOverwrite: boolean
  busy: boolean
  onApply: () => void
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

const num = (v: string, fallback: number) => (v.trim() === "" ? fallback : Math.max(0, Math.round(Number(v) || 0)))

export function SettingsRail({ value, onChange, pendingOverwrite, busy, onApply }: SettingsRailProps) {
  const set = <K extends keyof ChunkOptions>(k: K, v: ChunkOptions[K]) => onChange({ ...value, [k]: v })

  return (
    <aside className="flex flex-col gap-6 overflow-y-auto border-border/60 border-r px-5 py-6">
      <Field label="分隔符">
        <HaloInput
          className="font-mono"
          onChange={(e) => set("separator", e.target.value)}
          spellCheck={false}
          value={value.separator}
        />
      </Field>

      <Field label="每块字数">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <HaloInput
            className="tabular-nums"
            inputMode="numeric"
            onChange={(e) => set("min_chars", num(e.target.value, 0))}
            value={String(value.min_chars)}
          />
          <span className="text-muted-foreground">–</span>
          <HaloInput
            className="tabular-nums"
            inputMode="numeric"
            onChange={(e) => set("max_chars", num(e.target.value, 0))}
            value={String(value.max_chars)}
          />
        </div>
      </Field>

      <Field label="块开头">
        <HaloSegmented
          className="w-full"
          items={[
            { value: "breadcrumb", label: "路径" },
            { value: "headings", label: "标题" },
            { value: "none", label: "无" },
          ]}
          onValueChange={(v) => set("context", v as ContextMode)}
          value={value.context}
        />
        <label className="flex cursor-pointer items-center justify-between text-sm">
          来源页码
          <HaloSwitch checked={value.include_pages} onCheckedChange={(v) => set("include_pages", v)} size="sm" />
        </label>
      </Field>

      <Field label="表格">
        <HaloSegmented
          className="w-full"
          items={[
            { value: "markdown", label: "表格" },
            { value: "kv", label: "键值" },
          ]}
          onValueChange={(v) => set("table_mode", v as TableMode)}
          value={value.table_mode}
        />
        <HaloInput
          inputMode="numeric"
          onChange={(e) => set("table_max_rows", num(e.target.value, 0))}
          placeholder="不限"
          trailingSlot={<span className="text-xs">行 / 块</span>}
          value={value.table_max_rows ? String(value.table_max_rows) : ""}
        />
      </Field>

      {pendingOverwrite && (
        <Button className="mt-auto" disabled={busy} onClick={onApply} variant="destructive">
          <RefreshCw className={busy ? "animate-spin" : undefined} />
          覆盖编辑并应用
        </Button>
      )}
    </aside>
  )
}
