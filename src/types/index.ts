export interface Voucher {
  id: string
  user_id: string
  wallet_id: string
  store_name: string
  store_id?: string
  super_voucher_id?: string
  amount: number
  balance: number
  value_percent?: number
  actual_cost?: number
  code: string
  cvv?: string
  expiry_date?: string
  categories: string[]
  tags: string[]
  notes?: string
  link?: string
  source?: string
  is_archived: boolean
  is_shared: boolean
  is_gift?: boolean
  is_locked?: boolean
  lock_reason?: string
  is_e2ee?: boolean
  item_name?: string
  archive_reason?: string | null
  created_at: string
  updated_at: string
  // derived
  stores?: Store[]
}

export interface Store {
  id: string
  name: string
  logo_url?: string
  website?: string
  created_at?: string
}

export interface SuperVoucher {
  id: string
  wallet_id: string
  name: string
  description?: string
  stores: string[] // store names
  logo_url?: string
  is_global?: boolean
  balance_check_url?: string
  created_at: string
  updated_at: string
}

export interface Wallet {
  id: string
  name: string
  owner_id: string
  created_at: string
}

export interface WalletMember {
  id: string
  wallet_id: string
  user_id: string
  email: string
  role: 'owner' | 'member'
  created_at: string
}

export interface Profile {
  id: string
  email: string
  name?: string
  phone?: string
  avatar_url?: string
  show_voucher_value?: boolean
  is_admin?: boolean
  marketplace_payment_methods?: PaymentMethod[]
}

// ============ Marketplace Types ============

export interface PaymentMethod {
  type: 'paypal' | 'bit' | 'paybox' | 'cashcash' | 'lavi' | 'other'
  value: string  // email for paypal, phone number for others
  label?: string
}

export interface MarketplaceListing {
  id: string
  voucher_id: string
  seller_id: string
  asking_price: number
  reserved_price?: number | null
  reserved_buyer_id?: string | null
  description?: string
  status: 'active' | 'pending_payment' | 'sold' | 'cancelled'
  created_at: string
  updated_at?: string
  // from get_marketplace_listings RPC
  store_name?: string
  balance?: number
  expiry_date?: string
  seller_name?: string
  seller_email?: string
  avg_rating?: number
  rating_count?: number
  seller_payment_methods?: PaymentMethod[]
  is_verified_seller?: boolean
  // from get_my_listings RPC
  purchase_id?: string
  purchase_status?: string
  buyer_id?: string
  buyer_name?: string
  buyer_email?: string
  payment_method_used?: string
}

export interface MarketplacePurchase {
  purchase_id: string
  listing_id: string
  status: 'pending_buyer_payment' | 'buyer_confirmed' | 'completed' | 'cancelled'
  payment_method_used?: string
  buyer_confirmed_at?: string
  seller_confirmed_at?: string
  created_at: string
  // voucher/listing info
  store_name?: string
  balance?: number
  expiry_date?: string
  asking_price?: number
  // seller info
  seller_id?: string
  seller_name?: string
  seller_email?: string
  // rating
  my_rating?: number | null
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod['type'], string> = {
  paypal: 'PayPal',
  bit: 'Bit',
  paybox: 'Paybox',
  cashcash: 'Cashcash',
  lavi: 'לביא',
  other: 'אחר',
}

// ============ Marketplace Chat Types ============

export interface MarketplaceMessage {
  id: string
  listing_id: string
  sender_id: string
  receiver_id: string
  body: string
  msg_type: 'text' | 'price_offer'
  offer_amount?: number | null
  offer_status?: 'pending' | 'accepted' | 'rejected' | null
  created_at: string
  sender_name?: string | null
  sender_email?: string | null
  is_mine: boolean
  is_read?: boolean
}

// ============ Marketplace Settings ============

export interface MarketplaceSettings {
  free_listing_days: number
  pro_listing_days: number
  verified_min_rating: number
  verified_min_sales: number
  watchlist_pro_only: boolean
}

export interface WatchlistItem {
  id: string
  user_id: string
  store_name: string
  min_discount_pct: number
  notify_push: boolean
  notify_email: boolean
  created_at: string
}

export interface MarketplaceNotification {
  id: string
  user_id: string
  type: string
  title: string
  body: string
  listing_id?: string
  is_read: boolean
  created_at: string
}

export interface ListingConversation {
  other_user_id: string
  other_user_name?: string | null
  other_user_email?: string | null
  last_body: string
  last_at: string
  message_count: number
  unread_count?: number
}

export interface Category {
  id: string
  name: string
  emoji: string
  wallet_id?: string
}

export type MarketplaceMode = 'enabled' | 'disabled' | 'selective'
export type MarketplaceAccessStatus = 'none' | 'pending' | 'approved' | 'rejected'

export interface MarketplaceAccessRequest {
  user_id: string
  user_email: string | null
  user_name: string | null
  message: string | null
  status: MarketplaceAccessStatus
  created_at: string
  updated_at: string
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'fashion', name: 'אופנה', emoji: '👗' },
  { id: 'food', name: 'מזון', emoji: '🍕' },
  { id: 'electronics', name: 'אלקטרוניקה', emoji: '💻' },
  { id: 'beauty', name: 'יופי', emoji: '💅' },
  { id: 'home', name: 'בית', emoji: '🏠' },
  { id: 'sport', name: 'ספורט', emoji: '⚽' },
  { id: 'travel', name: 'נסיעות', emoji: '✈️' },
  { id: 'entertainment', name: 'בידור', emoji: '🎬' },
  { id: 'kids', name: 'ילדים', emoji: '🧸' },
  { id: 'health', name: 'בריאות', emoji: '💊' },
  { id: 'books', name: 'ספרים', emoji: '📚' },
  { id: 'restaurant', name: 'מסעדות', emoji: '🍽️' },
  { id: 'supermarket', name: 'סופר', emoji: '🛒' },
  { id: 'gift', name: 'מתנה', emoji: '🎁' },
  { id: 'other', name: 'אחר', emoji: '🔖' },
]

// ============ Smart Discount Matcher Types ============

export interface DiscountClub {
  id: string
  name: string
  logo_url?: string
  type: 'credit_card' | 'loyalty_club'
  is_active: boolean
  created_at: string
}

export interface DiscountBusiness {
  id: string
  name: string
  logo_url?: string
  website?: string
  tags: string[]
  store_id?: string
  created_at: string
}

export interface DiscountDeal {
  deal_id: string
  club_id: string
  club_name: string
  club_logo?: string
  business_id: string
  business_name: string
  business_logo?: string
  business_website?: string
  business_tags: string[]
  title: string
  description?: string
  discount_type: 'percent' | 'fixed' | 'free_item' | 'other'
  discount_value?: number
  promo_code?: string
  external_link?: string
  tags: string[]
  start_date?: string
  expiration_date?: string
  is_my_club: boolean
  is_upcoming: boolean
  view_count?: number
  is_liked?: boolean
  image_url?: string
}

export interface DiscountSubmission {
  id: string
  user_id?: string
  user_email?: string
  club_name: string
  business_name: string
  title: string
  description?: string
  discount_type: 'percent' | 'fixed' | 'free_item' | 'other'
  discount_value?: number
  promo_code?: string
  external_link?: string
  tags: string[]
  start_date?: string
  expiration_date?: string
  status: 'pending' | 'approved' | 'rejected'
  admin_notes?: string
  created_at: string
}

export const SUPER_VOUCHER_STORES: Record<string, string[]> = {
  'BuyMe': ['מגה, מגה בעיר', 'שופרסל', 'רמי לוי', 'ויקטורי', 'AM:PM', 'מחסני השוק', 'יינות ביתן', 'פרש מרקט', 'ספייסר', 'רנואר', 'קסטרו', 'אמריקן איגל', 'H&M', 'זארה', 'Mango', 'Fox', 'Timberland', 'ACE', 'אייס', 'Home Center', 'IKEA', 'נטו', 'דומינוס', 'פיצה האט', 'מקדונלדס', 'בורגר קינג', 'שוורמה הבית', 'קפה קפה', 'ארומה', 'קפה גרג', 'שילב', 'BBB', 'פנדה', 'גוטשה', 'רולדין', 'GOLF', 'אנג\'ל', 'ליפסטיק', 'ביגוד ואביזרים'],
  'תו הזהב': ['שופרסל', 'רמי לוי', 'ויקטורי', 'AM:PM', 'מחסני השוק', 'יינות ביתן', 'פרש מרקט', 'ספייסר', 'רנואר', 'קסטרו', 'H&M', 'זארה', 'Fox', 'ACE', 'Home Center', 'IKEA'],
  'נופשונית': ['Dan Hotels', 'Isrotel', 'Atlas Hotels', 'Prima Hotels', 'Leonardo Hotels', 'Brown Hotels', 'Fattal Hotels', 'Orchid Hotels', 'Herods Hotels'],
  'תו פלוס': ['ספייסר', 'רנואר', 'קסטרו', 'אמריקן איגל', 'H&M', 'זארה', 'Mango', 'Fox', 'Timberland', 'GOLF', 'ליפסטיק', 'קנס', 'ביגוד ואביזרים'],
  'Fun Online': ['כל הרכישות באינטרנט', 'Amazon', 'eBay', 'AliExpress', 'Zara Online', 'H&M Online', 'Fox Online', 'Terminalx', 'SHEIN'],
  'גיפט קארד ישראל': ['Amazon', 'iTunes', 'Google Play', 'Netflix', 'Spotify', 'Steam', 'PlayStation Store', 'Xbox'],
}
