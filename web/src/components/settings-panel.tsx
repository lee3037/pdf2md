import { useId, type ReactNode } from "react"
import { Collapsible } from "@base-ui/react/collapsible"
import { ChevronRight, Layers, ScanLine, Table2 } from "lucide-react"

import type { ChunkOptions, ContextMode, ConvertOptions, OcrMode, TableMode } from "@/lib/api"
import type { ParserCatalog } from "@/lib/use-parsers"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { AnimatedSwitch } from "@/components/spectrumui/animated-switch"
import { ModelSelector } from "@/components/spectrumui/blocks/ai-assistants/model-selector"
import { QuantityStepper } from "@/components/spectrumui/quantity-stepper"
import { SeparatorCombobox } from "@/components/separator-combobox"

interface SettingsPanelProps {
  catalog: ParserCatalog
  convert: ConvertOptions
  onConvert: (o: ConvertOptions) => void
  value: ChunkOptions
  onChange: (o: ChunkOptions) => void
  className?: string
}

/** 默认展开的参数卡片；折叠只改变显示，不重置草稿。 */
function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Collapsible.Root className="shrink-0 rounded-[18px] border border-border p-4" defaultOpen>
      <Collapsible.Trigger className="group flex w-full items-center gap-2 rounded-sm text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-[15px] [&>svg]:text-muted-foreground">
        {icon}
        {title}
        <ChevronRight className="ml-auto transition-transform group-data-[panel-open]:rotate-90 motion-reduce:transition-none" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none">
        <div className="flex flex-col gap-3.5 pt-4">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
      {label}
      {children}
    </div>
  )
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-border pt-3 text-xs">
      {label}
      <AnimatedSwitch checked={checked} label={label} onCheckedChange={onChange} size="sm" />
    </label>
  )
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { catalog, convert, value } = props
  const parser = catalog.parsers.find((p) => p.id === convert.parser)
  const separatorId = useId()
  const setConvert = <K extends keyof ConvertOptions>(k: K, v: ConvertOptions[K]) =>
    props.onConvert({ ...convert, [k]: v })
  const set = <K extends keyof ChunkOptions>(k: K, v: ChunkOptions[K]) => props.onChange({ ...value, [k]: v })

  return (
    <div className={cn("flex flex-col gap-3", props.className)}>
      <Section icon={<ScanLine />} title="识别">
        <div className="flex flex-col gap-2">
          <ModelSelector
            ariaLabel="解析方案"
            className="w-full max-w-none"
            models={[
              ...catalog.parsers.map((p) => ({
                id: p.id,
                name: p.name,
                badge: p.id === "oxr" ? "远程" : "本机",
              })),
              // 已保存的方案不在目录中时如实显示，不悄悄换成其他方案
              ...(parser ? [] : [{ id: convert.parser, name: convert.parser, description: "暂不可用", disabled: true }]),
            ]}
            onChange={(v) => setConvert("parser", v)}
            value={convert.parser}
          />
          {catalog.failed && (
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              无法加载解析方案
              <Button onClick={catalog.reload} size="xs" variant="ghost">
                重试
              </Button>
            </div>
          )}
        </div>
        {parser?.id === "oxr" && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">文件将发送到 OXR 服务。</p>
        )}
        {parser?.local_ocr_options && (
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
          </Field>
        )}
        {parser?.local_ocr_options && convert.ocr_mode !== "off" && (
          <Field label="分辨率">
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
          </Field>
        )}
        <SwitchRow
          checked={convert.remove_header_footer}
          label="去页眉页脚"
          onChange={(v) => setConvert("remove_header_footer", v)}
        />
      </Section>

      <Section icon={<Layers />} title="分块">
        <SeparatorCombobox appearance="outline" id={separatorId} onChange={(v) => set("separator", v)} value={value.separator} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="最少字数">
            <QuantityStepper
              className="w-full justify-between rounded-lg border border-border shadow-none"
              label="最少字数"
              max={value.max_chars}
              onValueChange={(v) => set("min_chars", v)}
              size="sm"
              step={50}
              value={value.min_chars}
            />
          </Field>
          <Field label="最多字数">
            <QuantityStepper
              className="w-full justify-between rounded-lg border border-border shadow-none"
              label="最多字数"
              max={10000}
              min={Math.max(100, value.min_chars)}
              onValueChange={(v) => set("max_chars", v)}
              size="sm"
              step={100}
              value={value.max_chars}
            />
          </Field>
        </div>
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

      <Section icon={<Table2 />} title="表格">
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
            className="w-[120px] justify-between rounded-lg border border-border shadow-none"
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
    </div>
  )
}
