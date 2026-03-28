interface IconProps {
  size?: number
  variant?: 'color' | 'white'
  className?: string
}

/** The GiftSmart icon mark (tag + checkmark + arrow + Z accent) */
export function GiftSmartIcon({ size = 80, variant = 'color', className = '' }: IconProps) {
  const green = variant === 'white' ? 'white' : '#22c55e'
  const purple = variant === 'white' ? 'rgba(255,255,255,0.75)' : '#9333ea'

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
        stroke={green} strokeWidth="6"
      />

      {/* Two tag dots — upper-left of diamond */}
      <circle cx="33" cy="33" r="4.5" fill={green} />
      <circle cx="43" cy="33" r="4.5" fill={green} />

      {/* Checkmark */}
      <path
        d="M30 52 L43 65 L70 38"
        stroke={green} strokeWidth="7"
        strokeLinecap="round" strokeLinejoin="round"
      />

      {/* Arrow pointing upper-right — purple, breaks out of corner */}
      <line x1="70" y1="26" x2="86" y2="12" stroke={purple} strokeWidth="6" strokeLinecap="round" />
      <path
        d="M78 10 L87 10 L87 19"
        stroke={purple} strokeWidth="6"
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
      <img src="/logo.png" alt="GiftSmart" className="w-24 h-24 object-contain" />
      <p className="text-4xl font-extrabold text-gray-800 tracking-tight mt-2">GiftSmart</p>
      <p className="text-sm text-gray-500">ניהול שוברים וכרטיסי מתנה</p>
    </div>
  )
}
