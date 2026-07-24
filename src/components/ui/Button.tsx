import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
  loading?: boolean
  children: ReactNode
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'text-white bg-gradient-to-br from-primary-mid to-primary-dark shadow-fab hover:brightness-105 active:brightness-95',
  secondary:
    'text-text bg-surface border border-border hover:bg-primary-light/40',
  ghost: 'text-text2 bg-transparent hover:bg-primary-light/40',
  danger: 'text-white bg-error hover:brightness-105 active:brightness-95',
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'text-sm px-4 py-2 gap-1.5',
  md: 'text-[15px] px-5 py-3 gap-2',
  lg: 'text-base px-6 py-4 gap-2',
}

/** Shared button primitive for the redesigned UI — brand tokens only, no ad-hoc colors. */
export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-btn font-bold transition disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? '…' : children}
    </button>
  )
}
