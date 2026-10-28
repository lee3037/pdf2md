// rewampui.com/components/split-text-reveal

import { motion, useReducedMotion, type Variants } from "motion/react"
import { cn } from "@/lib/utils"

// 偶数位字符从上方落下、奇数位从下方升起，偏移和倾角带随机量，逐个错开出场
const charVariants: Variants = {
  hidden: (i: number) => ({
    opacity: 0,
    y: (i % 2 === 0 ? -1 : 1) * (30 + Math.random() * 40),
    rotateZ: (i % 2 === 0 ? -1 : 1) * (5 + Math.random() * 10),
    filter: "blur(8px)",
  }),
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    rotateZ: 0,
    filter: "blur(0px)",
    transition: { delay: i * 0.06, duration: 0.8, ease: [0.22, 1, 0.36, 1] },
  }),
}

/** 挂载或文字变化时逐字飞入的标题文字；系统开启「减少动态效果」时直接显示。 */
export function SplitTextReveal({ text, className }: { text: string; className?: string }) {
  const reduceMotion = useReducedMotion()

  return (
    // 文字变化时整体重新挂载，让新文字重播飞入动画
    <span className={cn("inline-flex", className)} key={text}>
      <span className="sr-only">{text}</span>
      {text.split("").map((char, i) => (
        <motion.span
          animate="visible"
          aria-hidden
          className="inline-block whitespace-pre"
          custom={i}
          initial={reduceMotion ? false : "hidden"}
          // 字符按位置排列且不会增删，用下标作 key 即可
          key={i}
          variants={charVariants}
        >
          {char}
        </motion.span>
      ))}
    </span>
  )
}
