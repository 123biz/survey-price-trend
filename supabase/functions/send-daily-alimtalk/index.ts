import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { crypto } from "https://deno.land/std@0.177.0/crypto/mod.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // 1. 한국 시간 기준 오늘 날짜 구하기 (YYYY-MM-DD)
    const nowKst = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
    const todayStr = nowKst.toISOString().split('T')[0];

    // 2. 공휴일 테이블(public_holidays)에서 오늘 날짜 확인
    const { data: holiday } = await supabase
      .from('public_holidays')
      .select('holiday_name')
      .eq('holiday_date', todayStr)
      .maybeSingle();

    if (holiday) {
      console.log(`오늘은 공휴일(${holiday.holiday_name})이므로 발송을 건너뜁니다.`);
      return new Response(JSON.stringify({ message: `공휴일(${holiday.holiday_name}) 발송 제외` }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    // 3. 공휴일이 아니면 발송 대상 조회
    const { data: vendors } = await supabase.from('survey_vendors').select('*').eq('is_active', true)
    if (!vendors || vendors.length === 0) {
      return new Response("대상 없음", { headers: corsHeaders })
    }

    const API_KEY = Deno.env.get('SOLAPI_API_KEY')
    const API_SECRET = Deno.env.get('SOLAPI_SECRET')
    const SENDER_NO = Deno.env.get('SOLAPI_SENDER_NO')
    const PFID = Deno.env.get('SOLAPI_PFID')
    const TEMPLATE_ID = Deno.env.get('SOLAPI_TEMPLATE_ID')

    let success = 0;
    let fail = 0;

    // 4. 한 명씩 순차 발송
    for (const v of vendors) {
      const date = new Date().toISOString()
      const salt = Math.random().toString(36).substring(2, 12)
      const hmacMessage = date + salt
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey("raw", encoder.encode(API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      const sigBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(hmacMessage))
      const signature = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
      const authHeader = `HMAC-SHA256 apiKey=${API_KEY}, date=${date}, salt=${salt}, signature=${signature}`

      const payload = {
        message: {
          to: v.manager_phone.replace(/-/g, ''),
          from: SENDER_NO,
          type: "ATA",
          kakaoOptions: {
            pfId: PFID,
            templateId: TEMPLATE_ID,
            variables: {
              "#{manager_name}": v.manager_name,
              "#{vendor_name}": v.vendor_name,
              "#{url}": `survey-price-trend.pages.dev/input?key=${v.secret_key}`
            }
          }
        }
      }

      const res = await fetch("https://api.solapi.com/messages/v4/send", {
        method: "POST",
        headers: { "Authorization": authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (res.ok) success++; else fail++;

      // 0.1초 쉬어주기 (서버 연결 안정화)
      await new Promise(r => setTimeout(r, 100));
    }

    return new Response(JSON.stringify({ total: vendors.length, success, fail }), {
      status: 200,
      headers: corsHeaders,
    })

  } catch (err) {
    return new Response(err.message, { status: 500, headers: corsHeaders })
  }
})
