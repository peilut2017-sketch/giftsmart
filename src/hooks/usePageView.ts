import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function usePageView(page: string) {
  useEffect(() => {
    supabase.rpc('track_page_view', { p_page: page }).then(() => {})
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps
}
