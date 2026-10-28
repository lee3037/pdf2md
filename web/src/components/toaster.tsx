import { useEffect } from "react"

import { AnimatedToastStack, type ToastInput, useAnimatedToastStack } from "@/components/motion/animated-toast-stack"

let show: ((input: ToastInput) => string) | null = null

/** 全局提示：任意位置调用，由页面上唯一的 <Toaster /> 显示。 */
export function toast(input: ToastInput) {
  show?.(input)
}

export function Toaster() {
  const { toasts, showToast, dismissToast } = useAnimatedToastStack()

  useEffect(() => {
    show = showToast
    return () => {
      show = null
    }
  }, [showToast])

  return <AnimatedToastStack fixed onDismiss={dismissToast} position="bottom-right" toasts={toasts} />
}
