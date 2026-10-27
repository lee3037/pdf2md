import { useId, type ReactNode } from "react"
import { Collapsible } from "@base-ui/react/collapsible"
import { ChevronRight, RefreshCw, RotateCcw } from "lucide-react"

import type { ChunkOptions, ContextMode, ConvertOptions, OcrMode, TableMode } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { AnimatedSwitch } from "@/components/spectrumui/animated-switch"
import { ModelSelector } from "@/components/spectrumui/blocks/ai-assistants/model-selector"
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm"
import { QuantityStepper } from "@/components/spectrumui/quantity-stepper"
import { Hint } from "@/components/hint"
import { SeparatorCombobox } from "@/components/separator-combobox"

interface SettingsPanelProps {
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
  className?: string
}

/** 可折叠的参数分组。 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Collapsible.Root defaultOpen>
      <Collapsible.Trigger className="group flex w-full items-center gap-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
        {title}
      </Collapsible.Trigger>
      <Collapsible.Panel className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
        <div className="flex flex-col gap-3 pt-2 pb-1">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      {label}
      {children}
    </div>
  )
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-sm">
      {label}
      <AnimatedSwitch checked={checked} label={label} onCheckedChange={onChange} size="sm" />
    </label>
  )
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { convert, value } = props
  const separatorId = useId()
  const setConvert = <K extends keyof ConvertOptions>(k: K, v: ConvertOptions[K]) =>
    props.onConvert({ ...convert, [k]: v })
  const set = <K extends keyof ChunkOptions>(k: K, v: ChunkOptions[K]) => props.onChange({ ...value, [k]: v })

  return (
    <div className={cn("flex flex-col gap-4 px-5 py-4", props.className)}>
      <Section title="识别">
        <Field label="OCR">
          <ModelSelector
            ariaLabel="OCR"
            className="w-full"
            models={[
              { id: "auto", name: "自动", description: "仅对没有文字层或文字乱码的页面做 OCR" },
              { id: "force", name: "全部", description: "所有含图像的页面都重新 OCR" },
              { id: "off", name: "关闭", description: "只提取文字层，不做 OCR" },
            ]}
            onChange={(v) => setConvert("ocr_mode", v as OcrMode)}
            value={convert.ocr_mode}
            variant="Segmented"
          />
          {convert.ocr_mode !== "off" && (
            <ModelSelector
              ariaLabel="OCR 分辨率"
              className="w-full"
              models={[
                { id: "150", name: "150 dpi", description: "更快，小字号和表格数字可能出错" },
                { id: "200", name: "200 dpi", description: "速度与准确率均衡" },
                { id: "300", name: "300 dpi", description: "更准，速度较慢" },
              ]}
              onChange={(v) => setConvert("ocr_dpi", Number(v))}
              value={String(convert.ocr_dpi)}
              variant="Segmented"
            />
          )}
        </Field>
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
      </Section>

      <Section title="分块">
        <SeparatorCombobox id={separatorId} onChange={(v) => set("separator", v)} value={value.separator} />
        <Field label="每块字数">
          <div className="flex items-center gap-2">
            <QuantityStepper
              label="最少字数"
              max={value.max_chars}
              onValueChange={(v) => set("min_chars", v)}
              size="sm"
              step={50}
              value={value.min_chars}
            />
            <span className="text-muted-foreground">–</span>
            <QuantityStepper
              label="最多字数"
              max={10000}
              min={Math.max(100, value.min_chars)}
              onValueChange={(v) => set("max_chars", v)}
              size="sm"
              step={100}
              value={value.max_chars}
            />
          </div>
        </Field>
        <Field label="块开头">
          <ModelSelector
            ariaLabel="块开头"
            className="w-full"
            models={[
              { id: "breadcrumb", name: "路径", description: "每块开头加一行“章节路径 ｜ 页码”" },
              { id: "headings", name: "标题", description: "每块开头重复各级上级标题" },
              { id: "none", name: "无", description: "不添加章节信息" },
            ]}
            onChange={(v) => set("context", v as ContextMode)}
            value={value.context}
            variant="Segmented"
          />
        </Field>
        <SwitchRow checked={value.include_pages} label="来源页码" onChange={(v) => set("include_pages", v)} />
      </Section>

      <Section title="表格">
        <ModelSelector
          ariaLabel="表格格式"
          className="w-full"
          models={[
            { id: "markdown", name: "Markdown 表格", description: "保留为 Markdown 表格" },
            { id: "kv", name: "键值", description: "每行转为“列名：值”，宽表检索更准" },
          ]}
          onChange={(v) => set("table_mode", v as TableMode)}
          value={value.table_mode}
          variant="Segmented"
        />
        <Row label="每块行数">
          <QuantityStepper
            formatValue={(v) => (v === 0 ? "不限" : String(v))}
            label="每块行数"
            max={500}
            onValueChange={(v) => set("table_max_rows", v)}
            size="sm"
            step={5}
            value={value.table_max_rows}
          />
        </Row>
      </Section>

      {props.pendingOverwrite && (
        <Hint label="按住确认：按新参数重新分块，手动修改将丢失" side="top">
          <span className="flex">
            <HoldToConfirmButton
              className="w-full"
              confirmedLabel="已应用"
              disabled={props.busy}
              icon={<RefreshCw size={12} />}
              label="覆盖编辑并应用"
              onConfirm={props.onApply}
              size="sm"
            />
          </span>
        </Hint>
      )}
    </div>
  )
}
