import type { ReactNode } from "react"
import { RefreshCw, RotateCcw } from "lucide-react"

import type { ChunkOptions, ContextMode, ConvertOptions, OcrMode, TableMode } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { HaloInput } from "@/components/ui/halo-input"
import { HaloSegmented } from "@/components/ui/halo-segmented"
import { HaloSwitch } from "@/components/ui/halo-switch"
import { Hint } from "@/components/hint"

interface SettingsRailProps {
  convert: ConvertOptions
  onConvert: (o: ConvertOptions) => void
  /** 识别参数与当前结果不一致：可用同一文件重新转换 */
  reconvertable: boolean
  onReconvert: () => void
  value: ChunkOptions
  onChange: (o: ChunkOptions) => void
  /** 有手动编辑时分块参数改动不自动应用，显示覆盖按钮 */
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

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-sm">
      {label}
      <HaloSwitch checked={checked} onCheckedChange={onChange} size="sm" />
    </label>
  )
}

/** 分段选项的文字加悬停说明 */
const tip = (label: string, hint: string) => (
  <Hint label={hint}>
    <span>{label}</span>
  </Hint>
)

const num = (v: string, fallback: number) => (v.trim() === "" ? fallback : Math.max(0, Math.round(Number(v) || 0)))

export function SettingsRail(props: SettingsRailProps) {
  const { convert, value } = props
  const setConvert = <K extends keyof ConvertOptions>(k: K, v: ConvertOptions[K]) =>
    props.onConvert({ ...convert, [k]: v })
  const set = <K extends keyof ChunkOptions>(k: K, v: ChunkOptions[K]) => props.onChange({ ...value, [k]: v })

  return (
    <aside className="flex flex-col gap-6 overflow-y-auto border-border/60 border-r px-5 py-6">
      <Field label="OCR">
        <HaloSegmented
          className="w-full"
          items={[
            { value: "auto", label: tip("自动", "仅对没有文字层或文字乱码的页面做 OCR") },
            { value: "force", label: tip("全部", "所有含图像的页面都重新 OCR") },
            { value: "off", label: tip("关闭", "只提取文字层，不做 OCR") },
          ]}
          onValueChange={(v) => setConvert("ocr_mode", v as OcrMode)}
          value={convert.ocr_mode}
        />
        {convert.ocr_mode !== "off" && (
          <HaloSegmented
            className="w-full"
            items={[
              { value: "150", label: tip("150 dpi", "更快，小字号和表格数字可能出错") },
              { value: "200", label: tip("200 dpi", "速度与准确率均衡") },
              { value: "300", label: tip("300 dpi", "更准，速度较慢") },
            ]}
            onValueChange={(v) => setConvert("ocr_dpi", Number(v))}
            value={String(convert.ocr_dpi)}
          />
        )}
        <SwitchRow
          checked={convert.remove_header_footer}
          label="去页眉页脚"
          onChange={(v) => setConvert("remove_header_footer", v)}
        />
        {props.reconvertable && (
          <Hint label="按新的识别设置重新解析当前文件">
            <Button disabled={props.busy} onClick={props.onReconvert} variant="outline">
              <RotateCcw />
              重新转换
            </Button>
          </Hint>
        )}
      </Field>

      <hr className="border-border/60" />

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
            { value: "breadcrumb", label: tip("路径", "每块开头加一行“章节路径 ｜ 页码”") },
            { value: "headings", label: tip("标题", "每块开头重复各级上级标题") },
            { value: "none", label: tip("无", "不添加章节信息") },
          ]}
          onValueChange={(v) => set("context", v as ContextMode)}
          value={value.context}
        />
        <SwitchRow checked={value.include_pages} label="来源页码" onChange={(v) => set("include_pages", v)} />
      </Field>

      <Field label="表格">
        <HaloSegmented
          className="w-full"
          items={[
            { value: "markdown", label: tip("表格", "保留为 Markdown 表格") },
            { value: "kv", label: tip("键值", "每行转为“列名：值”，宽表检索更准") },
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

      {props.pendingOverwrite && (
        <Hint label="按新参数重新分块，手动修改将丢失" side="top">
          <Button className="mt-auto" disabled={props.busy} onClick={props.onApply} variant="destructive">
            <RefreshCw className={props.busy ? "animate-spin" : undefined} />
            覆盖编辑并应用
          </Button>
        </Hint>
      )}
    </aside>
  )
}
