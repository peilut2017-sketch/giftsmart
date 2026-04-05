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
}

export interface Category {
  id: string
  name: string
  emoji: string
  wallet_id?: string
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

export const SUPER_VOUCHER_STORES: Record<string, string[]> = {
  'BuyMe': ['מגה, מגה בעיר', 'שופרסל', 'רמי לוי', 'ויקטורי', 'AM:PM', 'מחסני השוק', 'יינות ביתן', 'פרש מרקט', 'ספייסר', 'רנואר', 'קסטרו', 'אמריקן איגל', 'H&M', 'זארה', 'Mango', 'Fox', 'Timberland', 'ACE', 'אייס', 'Home Center', 'IKEA', 'נטו', 'דומינוס', 'פיצה האט', 'מקדונלדס', 'בורגר קינג', 'שוורמה הבית', 'קפה קפה', 'ארומה', 'קפה גרג', 'שילב', 'BBB', 'פנדה', 'גוטשה', 'רולדין', 'GOLF', 'אנג\'ל', 'ליפסטיק', 'ביגוד ואביזרים'],
  'תו הזהב': ['שופרסל', 'רמי לוי', 'ויקטורי', 'AM:PM', 'מחסני השוק', 'יינות ביתן', 'פרש מרקט', 'ספייסר', 'רנואר', 'קסטרו', 'H&M', 'זארה', 'Fox', 'ACE', 'Home Center', 'IKEA'],
  'נופשונית': ['Dan Hotels', 'Isrotel', 'Atlas Hotels', 'Prima Hotels', 'Leonardo Hotels', 'Brown Hotels', 'Fattal Hotels', 'Orchid Hotels', 'Herods Hotels'],
  'תו פלוס': ['ספייסר', 'רנואר', 'קסטרו', 'אמריקן איגל', 'H&M', 'זארה', 'Mango', 'Fox', 'Timberland', 'GOLF', 'ליפסטיק', 'קנס', 'ביגוד ואביזרים'],
  'Fun Online': ['כל הרכישות באינטרנט', 'Amazon', 'eBay', 'AliExpress', 'Zara Online', 'H&M Online', 'Fox Online', 'Terminalx', 'SHEIN'],
  'גיפט קארד ישראל': ['Amazon', 'iTunes', 'Google Play', 'Netflix', 'Spotify', 'Steam', 'PlayStation Store', 'Xbox'],
}
