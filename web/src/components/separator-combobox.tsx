import { useState } from "react"
import { Combobox } from "@base-ui/react/combobox"
import { Check, ChevronDown } from "lucide-react"

import { addSeparator, loadSeparators } from "@/lib/separators"
import { cn } from "@/lib/utils"

const LABEL = "分隔符"

// 聚焦或有内容时标签上浮；用 :placeholder-shown 判断是否为空，所以输入框固定带一个空格占位
const FLOATED =
  "group-focus-within:-translate-y-5 group-focus-within:text-xs group-focus-within:text-[#5264AE] " +
  "group-has-[input:not(:placeholder-shown)]:-translate-y-5 group-has-[input:not(:placeholder-shown)]:text-xs group-has-[input:not(:placeholder-shown)]:text-[#5264AE]"

interface SeparatorComboboxProps {
  appearance?: "underline" | "outline"
  id?: string
  value: string
  onChange: (separator: string) => void
}

/**
 * 分隔符下拉框：可以从输入过的分隔符里选，也可以直接输入，回车确认后加入候选项。
 * 默认使用浮动标签下划线；卡片表单可使用静态标签和轻边框。
 */
export function SeparatorCombobox({ appearance = "underline", id, value, onChange }: SeparatorComboboxProps) {
  const outlined = appearance === "outline"
  const [options, setOptions] = useState(() => [...new Set([...loadSeparators(), value])])
  const [highlighted, setHighlighted] = useState<string>()
  const [root, setRoot] = useState<HTMLDivElement | null>(null)

  const commit = (typed: string) => {
    if (!typed.trim()) return
    setOptions(addSeparator(typed))
    onChange(typed)
  }

  return (
    <Combobox.Root
      // 打开时重新读取历史，拿到其他表单实例新加的分隔符。
      onOpenChange={(open) => open && setOptions((list) => [...new Set([...loadSeparators(), ...list])])}
      items={options}
      onItemHighlighted={(item: string | undefined) => setHighlighted(item)}
      onValueChange={(v: string | null) => v && onChange(v)}
      value={value}
    >
      <div className={cn("group relative", !outlined && "pt-5")} ref={setRoot}>
        {outlined && <label className="mb-1.5 block text-[11px] text-muted-foreground" htmlFor={id}>{LABEL}</label>}
        <Combobox.Input
          // 标签被拆成逐字的 span，读屏会念成「分 隔 符」，这里给出完整名称
          aria-label={LABEL}
          className={cn(
            "peer block w-full bg-transparent pr-7 font-mono outline-none",
            outlined
              ? "h-[34px] rounded-lg border border-border pl-2.5 text-xs focus-visible:ring-2 focus-visible:ring-ring"
              : "border-0 border-neutral-400 border-b py-2 pl-1 text-sm",
          )}
          id={id}
          onKeyDown={(e) => {
            // 没有高亮候选项时回车，表示确认输入的新分隔符
            if (e.key === "Enter" && highlighted === undefined) commit(e.currentTarget.value)
          }}
          placeholder=" "
          spellCheck={false}
        />
        {!outlined && <>
          <span className="absolute inset-x-0 bottom-0 h-0.5 scale-x-0 bg-[#5264AE] transition-transform duration-200 peer-focus:scale-x-100" />
          <label className="pointer-events-none absolute top-7 left-1 flex text-neutral-400 text-sm" htmlFor={id}>
            {Array.from(LABEL).map((char, i) => (
              <span className={cn("transition-all duration-200", FLOATED)} key={i} style={{ transitionDelay: `${i * 50}ms` }}>
                {char}
              </span>
            ))}
          </label>
        </>}
        <Combobox.Trigger
          aria-label="选择分隔符"
          className="absolute right-1 bottom-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:[&_svg]:rotate-180"
        >
          <ChevronDown className="size-4 transition-transform" />
        </Combobox.Trigger>
      </div>

      {/* 抽屉是模态层，弹出列表挂在抽屉外会点不到，所以在抽屉里时挂到抽屉内 */}
      <Combobox.Portal container={root?.closest<HTMLElement>("[role=dialog]") ?? undefined}>
        <Combobox.Positioner className="isolate z-50 outline-none" sideOffset={6}>
          <Combobox.Popup className="max-h-60 w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
            <Combobox.Empty className="px-2 py-1.5 text-muted-foreground text-xs empty:hidden">回车添加</Combobox.Empty>
            <Combobox.List>
              {(item: string) => (
                <Combobox.Item
                  className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 font-mono text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  key={item}
                  value={item}
                >
                  <span className="min-w-0 flex-1 truncate">{item}</span>
                  <Combobox.ItemIndicator>
                    <Check className="size-4" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
