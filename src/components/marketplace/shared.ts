// ─── Seller Profile Modal ─────────────────────────────────────────────────────
export interface SellerProfileRow {
  user_id: string
  full_name: string
  phone: string
  email: string
  id_number: string
  verification_status: 'pending' | 'verified' | 'rejected'
  admin_note: string | null
}
