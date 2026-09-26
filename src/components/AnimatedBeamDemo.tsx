"use client"

import React, { createRef, forwardRef, useMemo, useRef } from "react"
import { Fingerprint } from "lucide-react"

const cn = (...classes: (string | undefined)[]) => classes.filter(Boolean).join(" ")
import { AnimatedBeam } from "./magicui/AnimatedBeam"
import { FUNDING_CHAINS } from "../lib/chains"

const Circle = forwardRef<
  HTMLDivElement,
  { className?: string; children?: React.ReactNode }
>(({ className, children }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "z-10 flex items-center justify-center rounded-full border-2 border-neutral-200 bg-white p-3 shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)]",
        className ?? "size-12"
      )}
    >
      {children}
    </div>
  )
})

Circle.displayName = "Circle"

export function AnimatedBeamDemo() {
  const containerRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLDivElement>(null)
  const ensRef = useRef<HTMLDivElement>(null)
  const chainRefs = useMemo(
    () => FUNDING_CHAINS.map(() => createRef<HTMLDivElement>()),
    []
  )

  return (
    <div
      className="relative flex h-[300px] w-full items-center justify-center overflow-hidden px-3 py-6 sm:px-10"
      ref={containerRef}
      role="img"
      aria-label="USDC from supported chains flows to one Namepass address, then to ENS for renewal."
    >
      <div className="flex size-full max-w-lg items-center justify-between gap-4">
        <div className="flex h-full flex-col justify-between">
          {FUNDING_CHAINS.map((chain, i) => (
            <Circle key={chain.name} ref={chainRefs[i]}>
              <img
                src={`${import.meta.env.BASE_URL}logos/${chain.logo}`}
                alt={chain.name}
                className={`size-full object-contain ${chain.name === "Base" ? "scale-75" : ""}`}
              />
            </Circle>
          ))}
        </div>
        <Circle ref={addressRef} className="relative size-16 shrink-0">
          <Fingerprint aria-hidden="true" className="size-8 text-ink-primary" />
        </Circle>
        <Circle ref={ensRef} className="relative size-12 shrink-0">
          <img src={`${import.meta.env.BASE_URL}logos/ens.svg`} alt="ENS" className="size-full scale-125 object-contain" />
        </Circle>
      </div>

      {chainRefs.map((ref, i) => {
        const position = chainRefs.length > 1 ? 2 * i / (chainRefs.length - 1) - 1 : 0
        return (
          <AnimatedBeam
            key={FUNDING_CHAINS[i].name}
            containerRef={containerRef}
            fromRef={ref}
            toRef={addressRef}
            curvature={position * 75}
            endYOffset={position * 10}
          />
        )
      })}
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={addressRef}
        toRef={ensRef}
      />
    </div>
  )
}
