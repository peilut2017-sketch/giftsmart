interface IconProps {
  size?: number
  variant?: 'color' | 'white'
  className?: string
}

/** The GiftSmart icon mark (tag + checkmark + arrow + Z accent) */
export function GiftSmartIcon({ size = 80, variant = 'color', className = '' }: IconProps) {
  const green = variant === 'white' ? 'white' : '#22c55e'
  const purple = variant === 'white' ? 'rgba(255,255,255,0.75)' : '#a855f7'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Rounded diamond / gift-tag shape */}
      <rect
        x="16" y="16" width="68" height="68" rx="12"
        transform="rotate(45 50 50)"
        stroke={green} strokeWidth="6.5"
      />

      {/* Tag hole — upper-left of diamond */}
      <circle cx="35" cy="35" r="5.5" fill={green} />

      {/* Checkmark */}
      <path
        d="M30 51 L43 64 L70 37"
        stroke={green} strokeWidth="7"
        strokeLinecap="round" strokeLinejoin="round"
      />

      {/* Arrow pointing upper-right (breaks out of the top-right corner) */}
      <line x1="68" y1="28" x2="82" y2="14" stroke={green} strokeWidth="6" strokeLinecap="round" />
      <path
        d="M76 13 L83 13 L83 20"
        stroke={green} strokeWidth="6"
        strokeLinecap="round" strokeLinejoin="round"
      />

      {/* Cursive Z accent — lower-right, purple */}
      <path
        d="M62 66 C70 57 80 68 75 77 C71 83 63 81 61 88"
        stroke={purple} strokeWidth="4.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Full logo: icon + "GiftSmart" text + Hebrew subtitle */
export function GiftSmartLogoFull({ iconSize = 72 }: { iconSize?: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <GiftSmartIcon size={iconSize} variant="color" />
      <p className="text-3xl font-extrabold text-gray-800 tracking-tight mt-1">GiftSmart</p>
      <p className="text-sm text-gray-500">ניהול שוברים וכרטיסי מתנה</p>
    </div>
  )
}

/** Splash variant: large icon + app name, used on loading / splash screen */
export function GiftSmartSplash() {
  return (
    <div className="flex flex-col items-center gap-2">
      <GiftSmartIcon size={96} variant="color" />
      <p className="text-4xl font-extrabold text-gray-800 tracking-tight mt-2">GiftSmart</p>
      <p className="text-sm text-gray-500">ניהול שוברים וכרטיסי מתנה</p>
    </div>
  )
}
