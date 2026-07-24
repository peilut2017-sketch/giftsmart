interface IconProps {
  /** Material Symbols icon name, e.g. "search", "account_balance_wallet" */
  name: string
  size?: number
  /** Filled (solid) variant vs outline — Material Symbols FILL axis */
  filled?: boolean
  /** Variable-font weight axis (100-700) */
  weight?: number
  color?: string
  className?: string
  'aria-label'?: string
  'aria-hidden'?: boolean
}

/**
 * Thin wrapper around the Material Symbols Rounded icon font.
 * Replaces per-icon lucide-react SVG components in redesigned screens.
 */
export default function Icon({
  name,
  size = 24,
  filled = false,
  weight = 400,
  color,
  className = '',
  'aria-label': ariaLabel,
  'aria-hidden': ariaHidden,
}: IconProps) {
  return (
    <span
      className={`material-symbols-rounded${filled ? ' ms-fill' : ''}${className ? ` ${className}` : ''}`}
      style={{
        fontSize: size,
        color,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 24`,
      }}
      aria-hidden={ariaHidden ?? (ariaLabel ? undefined : true)}
      aria-label={ariaLabel}
    >
      {name}
    </span>
  )
}
