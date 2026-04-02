// Supabase 클라이언트 설정 파일
// .env 파일에서 URL과 키를 읽어와서 연결합니다
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Supabase 클라이언트 생성 (앱 전체에서 이 객체를 사용)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
