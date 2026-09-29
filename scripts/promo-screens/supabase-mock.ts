/* eslint-disable @typescript-eslint/no-explicit-any -- loose mock of the Supabase client */
/**
 * Stand-in for src/lib/supabase.ts, used ONLY by the promo screenshot harness
 * (vite.screens.config.ts). It lets the real, unmodified GiftSmart app render
 * with fake demo data and no network: no real account, no real vouchers.
 *
 * Every query resolves locally from FIXTURES below; writes are accepted and
 * dropped (and mirrored into the in-memory table so the UI stays consistent).
 */

const DAY = 86_400_000
const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10)
const now = new Date().toISOString()

const USER = {
  id: 'demo-user',
  email: 'demo@giftsmart.site',
  is_anonymous: false,
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: { name: 'דמו' },
  created_at: now,
}
const SESSION = { access_token: 'demo', refresh_token: 'demo', token_type: 'bearer', expires_in: 3600, expires_at: 9_999_999_999, user: USER }
const WALLET = 'demo-wallet'

// All codes are fake — they look like voucher codes but map to nothing.
const v = (id: string, store_name: string, amount: number, balance: number, days: number, cat: string, code: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: USER.id, wallet_id: WALLET, store_name, amount, balance, code,
  expiry_date: iso(days), categories: [cat], tags: [], source: null,
  is_archived: false, is_shared: false, is_gift: false, is_locked: false, is_e2ee: false,
  created_at: now, updated_at: now, ...extra,
})

/** Override via window.__PROMO_FIXTURE__ before the app boots (the capture script does this per scene). */
const DEFAULT_VOUCHERS = [
  v('v-zara', 'ZARA', 240, 240, 460, 'אופנה', 'GS7Q4K2291'),
  v('v-fox', 'FOX', 200, 175, 7, 'אופנה', 'GS3M8D5510'),
  v('v-buyme', 'BUYME', 320, 320, 330, 'מתנה', 'GS9T2P0184'),
  v('v-shuf', 'שופרסל', 150, 110, 480, 'סופר', 'GS5W1H7736'),
  v('v-golf', 'Golf & Co', 90, 90, 270, 'בית', 'GS2B6N4420'),
  v('v-ace', 'ACE', 120, 120, 390, 'בית', 'GS8R3C1057'),
]

type Row = Record<string, any>
const w = globalThis as any
const fixture = (w.__PROMO_FIXTURE__ ?? {}) as { vouchers?: Row[] }

const TABLES: Record<string, Row[]> = {
  vouchers: fixture.vouchers ?? DEFAULT_VOUCHERS,
  profiles: [{ id: USER.id, email: USER.email, name: 'דמו', show_voucher_value: false, is_admin: false }],
  wallets: [{ id: WALLET, name: 'ארנק השוברים שלי', owner_id: USER.id, created_at: now }],
  wallet_members: [{ id: 'wm', wallet_id: WALLET, user_id: USER.id, email: USER.email, role: 'owner', created_at: now }],
}

const RPC: Record<string, unknown> = {
  get_or_create_user_wallet: WALLET,
  get_premium_enabled: false,
  get_marketplace_mode: 'off',
  should_send_welcome_email: false,
}

type Filter = (r: Row) => boolean

class Query implements PromiseLike<{ data: any; error: null; count?: number }> {
  private filters: Filter[] = []
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private payload: any = null
  private one = false
  private maybe = false
  private lim = Infinity
  constructor(private table: string) {}

  select() { return this }
  insert(p: any) { this.op = 'insert'; this.payload = p; return this }
  upsert(p: any) { this.op = 'upsert'; this.payload = p; return this }
  update(p: any) { this.op = 'update'; this.payload = p; return this }
  delete() { this.op = 'delete'; return this }
  eq(k: string, val: any) { this.filters.push(r => r[k] === val); return this }
  neq(k: string, val: any) { this.filters.push(r => r[k] !== val); return this }
  in(k: string, vals: any[]) { this.filters.push(r => vals.includes(r[k])); return this }
  limit(n: number) { this.lim = n; return this }
  single() { this.one = true; return this }
  maybeSingle() { this.one = true; this.maybe = true; return this }
  // Accepted but not needed for the demo data
  or() { return this } ; not() { return this } ; is() { return this } ; order() { return this }
  range() { return this } ; gt() { return this } ; gte() { return this } ; lt() { return this } ; lte() { return this }
  ilike() { return this } ; like() { return this } ; match() { return this } ; filter() { return this } ; contains() { return this }
  abortSignal() { return this } ; returns() { return this } ; throwOnError() { return this }

  private run() {
    const rows = (TABLES[this.table] ??= [])
    const hit = rows.filter(r => this.filters.every(f => f(r)))
    if (this.op === 'update') hit.forEach(r => Object.assign(r, this.payload))
    if (this.op === 'delete') TABLES[this.table] = rows.filter(r => !hit.includes(r))
    if (this.op === 'insert' || this.op === 'upsert') {
      const items = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p: Row) => ({ id: `mock-${Math.random().toString(36).slice(2)}`, created_at: now, ...p }))
      rows.push(...items)
      return { data: this.one ? items[0] : items, error: null }
    }
    const out = hit.slice(0, this.lim)
    return { data: this.one ? (out[0] ?? null) : out, error: null, count: out.length }
  }

  then<A = any, B = never>(ok?: ((v: any) => A | PromiseLike<A>) | null, bad?: ((e: any) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, bad)
  }
}

const channel = () => {
  const ch: any = { on: () => ch, subscribe: (cb?: (s: string) => void) => { cb?.('SUBSCRIBED'); return ch }, unsubscribe: async () => 'ok', send: async () => 'ok' }
  return ch
}

const ok = <T,>(data: T) => Promise.resolve({ data, error: null })

export const supabase = {
  from: (table: string) => new Query(table),
  rpc: (name: string) => ok(name in RPC ? RPC[name] : null),
  channel,
  removeChannel: async () => 'ok',
  removeAllChannels: async () => [],
  functions: { invoke: () => ok(null) },
  storage: { from: () => ({ upload: () => ok(null), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: () => ok(null) }) },
  auth: {
    getSession: () => ok({ session: SESSION }),
    getUser: () => ok({ user: USER }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    refreshSession: () => ok({ session: SESSION, user: USER }),
    signInAnonymously: () => ok({ session: SESSION, user: USER }),
    signInWithPassword: () => ok({ session: SESSION, user: USER }),
    signInWithOAuth: () => ok({}),
    signUp: () => ok({ session: SESSION, user: USER }),
    signOut: () => ok(null),
    updateUser: () => ok({ user: USER }),
    resetPasswordForEmail: () => ok({}),
  },
}

export type SupabaseClient = typeof supabase
