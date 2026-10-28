'use client';

import { useState } from 'react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/hint';
import type { ModelOption } from './types';

export type ModelSelectorVariant = 'List' | 'Segmented';

export interface ModelSelectorProps {
  models: ModelOption[];
  value?: string;
  onChange?: (id: string) => void;
  variant?: ModelSelectorVariant;
  ariaLabel?: string;
  className?: string;
}

export function ModelSelector({
  models,
  value: valueProp,
  onChange,
  variant = 'List',
  ariaLabel = 'Model',
  className,
}: ModelSelectorProps) {
  const [valueState, setValueState] = useState(models.find((m) => !m.disabled)?.id);
  const value = valueProp !== undefined ? valueProp : valueState;

  function select(id: string) {
    setValueState(id);
    onChange?.(id);
  }

  if (variant === 'Segmented') {
    const enabled = models.filter((model) => !model.disabled);
    const activeIndex = Math.max(0, enabled.findIndex((model) => model.id === value));
    return (
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className={cn(
          'relative isolate grid w-fit grid-flow-col auto-cols-fr rounded-lg bg-black/[0.04] p-0.5 dark:bg-white/[0.05]',
          className,
        )}
      >
        <span
          aria-hidden
          className="absolute inset-y-0.5 left-0.5 -z-10 rounded-[7px] bg-white shadow-xs transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] dark:bg-neutral-800"
          style={{
            width: `calc((100% - 4px) / ${enabled.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
        {enabled.map((model) => {
          const active = model.id === value;
          const button = (
            <button
              key={model.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => select(model.id)}
              className={cn(
                'whitespace-nowrap rounded-[7px] px-3 py-1.5 text-xs transition-[color,transform] duration-150 active:scale-[0.96]',
                'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-neutral-400',
                active
                  ? 'font-medium text-neutral-900 dark:text-neutral-50'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
              )}
            >
              {model.name}
            </button>
          );
          return model.description ? (
            <Hint key={model.id} label={model.description}>
              {button}
            </Hint>
          ) : (
            button
          );
        })}
      </div>
    );
  }

  return (
    <RadioGroup value={value} onValueChange={select} aria-label={ariaLabel} className={cn('w-full max-w-[380px] space-y-1.5', className)}>
      {models.map((model) => {
        const active = model.id === value;
        return (
          <Radio.Root
            key={model.id}
            value={model.id}
            disabled={model.disabled}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2.5 rounded-[11px] border px-3 py-2.5 text-left',
              'transition-[border-color,background-color,transform] duration-150',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-neutral-400',
              model.disabled
                ? 'cursor-not-allowed border-black/[0.05] opacity-45 dark:border-white/[0.06]'
                : active
                  ? 'border-sky-400 bg-sky-50/70 dark:border-sky-600 dark:bg-sky-950/40'
                  : 'border-black/[0.07] hover:border-black/[0.14] active:scale-[0.99] dark:border-white/[0.08] dark:hover:border-white/[0.16]',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'grid size-3.5 shrink-0 place-items-center rounded-full border transition-colors duration-150',
                active
                  ? 'border-sky-500 dark:border-sky-400'
                  : 'border-neutral-300 dark:border-neutral-600',
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full bg-sky-500 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] dark:bg-sky-400',
                  active ? 'scale-100' : 'scale-0',
                )}
              />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                {model.name}
              </span>
              {model.description && (
                <span className="block truncate text-[11.5px] text-neutral-500 dark:text-neutral-500">
                  {model.description}
                </span>
              )}
            </span>

            {model.badge && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {model.badge}
              </span>
            )}
          </Radio.Root>
        );
      })}
    </RadioGroup>
  );
}

export default ModelSelector;
