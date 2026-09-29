import type { ReactNode } from 'react'
import { Mail, MessageCircle, MessageSquare, ImageIcon, Store, ShoppingBag, Coffee } from 'lucide-react'
import { BRAND } from './config'
import { CENTER } from './layout'
import { SPR, ease, ep, lerp, prog, rand, spring } from './timeline'
import { Barcode, GiftCardFace } from './ui'

/**
 * Scenes 1 + 2: the mess of vouchers scattered across apps, then the suction
 * into the Gift Smart mark. All codes here are fake.
 */

const shadow = '0 1px 2px rgba(15,28,26,.06), 0 18px 40px -14px rgba(15,28,26,.22)'
const card = { background: '#fff', borderRadius: 28, boxShadow: shadow, border: '1px solid rgba(15,28,26,.06)' }

function SourceHeader({ icon, label, color, time }: { icon: ReactNode; label: string; color: string; time: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{icon}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: BRAND.text }}>{label}</div>
      <div style={{ marginInlineStart: 'auto', fontSize: 20, color: BRAND.text3 }}>{time}</div>
    </div>
  )
}

const Code = ({ children }: { children: ReactNode }) => (
  <span style={{ direction: 'ltr', unicodeBidi: 'isolate', fontFeatureSettings: '"tnum"', fontWeight: 700, letterSpacing: '0.04em', color: BRAND.text }}>{children}</span>
)

const WhatsApp = () => (
  <div style={{ ...card, width: 400, padding: 22 }}>
    <SourceHeader icon={<MessageCircle size={22} strokeWidth={2.4} />} label="WhatsApp" color="#25d366" time="14:02" />
    <div style={{ background: '#e7fbe9', borderRadius: 18, padding: '14px 18px', fontSize: 26, lineHeight: 1.4, color: BRAND.text }}>
      שלחתי לך שובר מתנה!<br />קוד: <Code>4829-1173</Code>
    </div>
  </div>
)

const Email = () => (
  <div style={{ ...card, width: 420, padding: 22 }}>
    <SourceHeader icon={<Mail size={22} strokeWidth={2.4} />} label="מייל" color="#3b82f6" time="אתמול" />
    <div style={{ fontSize: 27, fontWeight: 800, color: BRAND.text, lineHeight: 1.3 }}>קיבלת גיפט קארד בשווי ₪320</div>
    <div style={{ fontSize: 22, color: BRAND.text3, marginTop: 6 }}>לחצו כאן למימוש השובר…</div>
  </div>
)

const Sms = () => (
  <div style={{ ...card, width: 380, padding: 22 }}>
    <SourceHeader icon={<MessageSquare size={22} strokeWidth={2.4} />} label="SMS" color="#64748b" time="09:15" />
    <div style={{ background: '#eef1f4', borderRadius: 18, padding: '14px 18px', fontSize: 25, lineHeight: 1.4, color: BRAND.text }}>
      שובר ₪150 לרשת. קוד <Code>5W1H-7736</Code>
    </div>
  </div>
)

const Screenshot = () => (
  <div style={{ width: 230, height: 400, borderRadius: 30, background: '#fff', padding: 10, boxShadow: shadow, border: '1px solid rgba(15,28,26,.06)' }}>
    <div style={{ width: '100%', height: '100%', borderRadius: 22, background: 'linear-gradient(180deg,#f1f5f9,#e2e8f0)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 14, insetInlineStart: 14, display: 'flex', alignItems: 'center', gap: 6, fontSize: 17, color: BRAND.text3, fontWeight: 600 }}>
        <ImageIcon size={18} /> צילום מסך
      </div>
      <div style={{ fontSize: 30, fontWeight: 900, color: BRAND.text }}>₪100</div>
      <div style={{ background: '#fff', padding: '10px 12px', borderRadius: 10 }}><Barcode seed={7} width={150} height={60} /></div>
      <div style={{ fontSize: 18, color: BRAND.text3 }}><Code>0417 2290</Code></div>
    </div>
  </div>
)

const CodeChip = ({ code }: { code: string }) => (
  <div style={{ background: '#fff', border: '2px dashed #cbd5e1', borderRadius: 18, padding: '14px 24px', fontSize: 30, boxShadow: shadow }}>
    <Code>{code}</Code>
  </div>
)

const StoreDot = ({ icon, color }: { icon: ReactNode; color: string }) => (
  <div style={{ width: 104, height: 104, borderRadius: 32, background: '#fff', boxShadow: shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
    {icon}
  </div>
)

interface Item { x: number; y: number; rot: number; at: number; node: ReactNode; depth: number }

const ITEMS: Item[] = [
  { x: 315, y: 720,  rot: -6,  at: 0.15, depth: 1,   node: <WhatsApp /> },
  { x: 770, y: 865,  rot: 5,   at: 0.4,  depth: 0.9, node: <Email /> },
  { x: 285, y: 1085, rot: -11, at: 0.62, depth: 1.1, node: <GiftCardFace brand="ZARA" from="#111827" to="#374151" value="₪240" width={360} /> },
  { x: 790, y: 1215, rot: -4,  at: 0.85, depth: 1,   node: <Sms /> },
  { x: 215, y: 1430, rot: 8,   at: 1.05, depth: 0.85, node: <Screenshot /> },
  { x: 800, y: 1545, rot: 10,  at: 1.25, depth: 1.1, node: <GiftCardFace brand="BUYME" from="#fb923c" to="#ea580c" value="₪320" width={340} /> },
  { x: 560, y: 1010, rot: 3,   at: 1.42, depth: 1.2, node: <CodeChip code="GS-9T2P-0184" /> },
  { x: 130, y: 880,  rot: -8,  at: 1.6,  depth: 0.8, node: <StoreDot icon={<ShoppingBag size={50} strokeWidth={2} />} color="#6366f1" /> },
  { x: 955, y: 660,  rot: 9,   at: 1.72, depth: 0.8, node: <StoreDot icon={<Store size={50} strokeWidth={2} />} color="#e11d48" /> },
  { x: 950, y: 1390, rot: -7,  at: 1.86, depth: 0.8, node: <StoreDot icon={<Coffee size={50} strokeWidth={2} />} color="#0ea5e9" /> },
  { x: 525, y: 1330, rot: -3,  at: 2.05, depth: 1.25, node: <GiftCardFace brand="FOX" from="#6366f1" to="#4338ca" value="₪175" width={330} /> },
  { x: 470, y: 1690, rot: 4,   at: 2.3,  depth: 1,   node: <CodeChip code="PIN 3308" /> },
  { x: 760, y: 655,  rot: -3,  at: 2.5,  depth: 1.3, node: <CodeChip code="7730-5519-20" /> },
]

export const SUCK_AT = 4.0
const SUCK_DUR = 0.62

export default function Chaos({ t }: { t: number }) {
  if (t > SUCK_AT + 1.2) return null
  // Camera: slow zoom-out as the pile grows (0–4s)
  const cam = lerp(1.1, 1, ep(t, 0, 4, ease.soft))
  return (
    <div style={{ position: 'absolute', inset: 0, transform: `scale(${cam})`, transformOrigin: `${CENTER.x}px ${CENTER.y - 100}px` }}>
      {ITEMS.map((it, i) => {
        if (t < it.at) return null
        const s = spring(t, it.at, SPR.pop)
        const bob = Math.sin(t * 1.3 + i) * 6 * it.depth
        // Suction into the mark
        const start = SUCK_AT + (ITEMS.length - 1 - i) * 0.028
        const sp = ease.in(prog(t, start, start + SUCK_DUR))
        const vel = ease.in(prog(t + 1 / 60, start, start + SUCK_DUR)) - sp
        const x = lerp(it.x, CENTER.x, sp)
        const y = lerp(it.y + bob, CENTER.y, sp)
        const scale = lerp(0.55, 1, s) * lerp(1, 0.08, sp)
        const rot = it.rot + (1 - s) * (rand(i) > 0.5 ? 14 : -14) + sp * (i % 2 ? 90 : -90)
        const blur = Math.min(14, vel * 260)
        const opacity = Math.min(1, s * 1.4) * (1 - ep(t, start + SUCK_DUR * 0.7, start + SUCK_DUR))
        if (opacity <= 0.001) return null
        return (
          <div
            key={i}
            style={{
              position: 'absolute', left: x, top: y,
              transform: `translate(-50%,-50%) rotate(${rot}deg) scale(${scale})`,
              opacity,
              filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
              zIndex: Math.round(it.depth * 10),
              willChange: 'transform',
            }}
          >
            {it.node}
          </div>
        )
      })}
    </div>
  )
}
