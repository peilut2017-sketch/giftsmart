import { useState, useEffect, useCallback } from 'react'

const DURATION = 5 // seconds

interface Props {
  imageUrl: string
  onDismiss: () => void
}

export default function LoginBanner({ imageUrl, onDismiss }: Props) {
  const [timeLeft, setTimeLeft] = useState(DURATION)

  const dismiss = useCallback(() => onDismiss(), [onDismiss])

  useEffect(() => {
    if (timeLeft <= 0) { dismiss(); return }
    const t = setTimeout(() => setTimeLeft(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [timeLeft, dismiss])

  const R = 13
  const circumference = 2 * Math.PI * R
  // Full circle at DURATION, zero at 0
  const offset = circumference * (timeLeft / DURATION)

  return (
    <div className="fixed inset-0 z-[300] bg-black flex items-center justify-center" dir="rtl">
      <img
        src={imageUrl}
        alt="באנר כניסה"
        className="w-full h-full object-contain select-none"
        draggable={false}
      />

      {/* Skip button with circular countdown */}
      <button
        onClick={dismiss}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/50 backdrop-blur-md text-white px-5 py-2.5 rounded-full text-sm font-semibold border border-white/25 hover:bg-black/70 transition-colors shadow-lg"
      >
        {/* Ring + number */}
        <span className="relative flex items-center justify-center w-8 h-8 flex-shrink-0">
          <svg width="32" height="32" className="-rotate-90 absolute inset-0">
            <circle cx="16" cy="16" r={R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
            <circle
              cx="16" cy="16" r={R}
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference - offset}
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <span className="relative text-white text-[11px] font-bold leading-none">{timeLeft}</span>
        </span>
        דלג
      </button>
    </div>
  )
}
