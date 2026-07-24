import type { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** Renders as a <button>-like clickable card when true (adds hover/active affordance). Use onClick with a real <button> wrapper for a11y when fully interactive. */
  interactive?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const PADDING_CLASSES: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
}

/** Shared surface/card primitive matching the redesign's rounded-card + shadow-card tokens. */
export default function Card({
  children,
  interactive = false,
  padding = 'md',
  className = '',
  ...rest
}: CardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded-card shadow-card ${PADDING_CLASSES[padding]} ${interactive ? 'transition active:scale-[0.98]' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}
