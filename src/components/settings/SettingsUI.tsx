import type React from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../ui/Icon'

/** Shared header for every settings sub-page — back button + title, normal flow (not
    fixed/sticky; these are short simple pages so a header that scrolls away with the
    rest of the content is fine, and avoids the app's known position:sticky/fixed pitfalls
    that only matter for long, complex pages like Checkout). */
export function SettingsSubHeader({ title }: { title: string }) {
  const navigate = useNavigate()
  return (
    <div className="bg-surface border-b border-border px-4 py-3 flex items-center gap-3">
      <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-bg">
        <Icon name="arrow_forward" size={22} color="var(--c-text)" />
      </button>
      <h1 className="text-base font-bold text-text">{title}</h1>
    </div>
  )
}

export function MenuItem({ icon, label, desc, onClick, danger = false, right }: { icon: string; label: string; desc?: string; onClick?: () => void; danger?: boolean; right?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-4 transition-colors rounded-2xl text-right hover:bg-bg"
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-error/10' : 'bg-bg'}`}>
        <Icon name={icon} size={20} color={danger ? 'var(--c-error)' : 'var(--c-text2)'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${danger ? 'text-error' : 'text-text'}`}>{label}</p>
        {desc && <p className="text-xs text-text3">{desc}</p>}
      </div>
      {right || <Icon name="chevron_left" size={16} color="var(--c-text3)" />}
    </button>
  )
}

export function SL({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold text-text3 uppercase tracking-wider px-5 pt-4 pb-1.5">{children}</div>
}

export function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface rounded-card shadow-card overflow-hidden mb-1">{children}</div>
}

export function Spinner({ color = 'var(--c-primary)', size = 20 }: { color?: string; size?: number }) {
  return <Icon name="progress_activity" size={size} color={color} className="animate-spin" />
}

export function Switch({ checked, onChange, size = 'md', ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; size?: 'sm' | 'md'; ariaLabel?: string }) {
  const track = size === 'md' ? 'w-12 h-6' : 'w-10 h-5'
  const thumb = size === 'md' ? 'w-5 h-5' : 'w-4 h-4'
  const onPos = size === 'md' ? 'translate-x-0.5' : 'translate-x-5'
  const offPos = size === 'md' ? 'right-0.5' : 'translate-x-0.5'
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative ${track} rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-primary' : 'bg-border'}`}
    >
      <span className={`absolute top-0.5 ${thumb} bg-white rounded-full shadow transition-transform ${checked ? onPos : offPos}`} />
    </button>
  )
}
