import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { crypto } from "https://deno.land/std@0.177.0/crypto/mod.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // 1. 한국 시간 기준 날짜 및 요일 파악 (가장 안전한 방식)
    const formatter = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
    });
    const parts = formatter.formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    const dayOfWeekStr = parts.find(p => p.type === 'weekday')?.value; // 월, 화, 수...

    const todayStr = `${y}-${m}-${d}`;

    // 내일과 모레 날짜 계산
    const tomorrow = new Date(new Date().getTime() + 86400000);
    const dayAfter = new Date(new Date().getTime() + 172800000);

    const getStr = (date: Date) => {
      const p = new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date);
      return `${p.find(x=>x.type==='year')?.value}-${p.find(x=>x.type==='month')?.value}-${p.find(x=>x.type==='day')?.value}`;
    };

    const tomorrowStr = getStr(tomorrow);
    const dayAfterStr = getStr(dayAfter);

    // 2. 오늘, 내일, 모레 공휴일 여부 확인
    const { data: holidays } = await supabase
      .from('public_holidays')
      .select('holiday_date')
      .in('holiday_date', [todayStr, tomorrowStr, dayAfterStr]);

    const isTodayH = holidays?.some(h => h.holiday_date === todayStr);
    const isTomorrowH = holidays?.some(h => h.holiday_date === tomorrowStr);
    const isAfterH = holidays?.some(h => h.holiday_date === dayAfterStr);

    // 3. 발송 여부 판단
    let shouldSend = false;
    let reason = "";

    if (isTodayH) {
      reason = "오늘은 공휴일이라 쉽니다.";
    } else {
      if (dayOfWeekStr === '금') {
        shouldSend = true;
        reason = "정기 금요일 조사";
      }
      else if (dayOfWeekStr === '목') {
        if (isTomorrowH) {
          shouldSend = true;
          reason = "내일(금) 휴무로 인한 목요일 조기 발송";
        } else {
          reason = "내일(금)이 평일이므로 오늘(목)은 대기";
        }
      }
      else if (dayOfWeekStr === '수') {
        if (isTomorrowH && isAfterH) {
          shouldSend = true;
          reason = "목/금 연쇄 휴무로 인한 수요일 조기 발송";
        } else {
          reason = "목/금 중 평일이 있으므로 수요일은 대기";
        }
      }
    }

    if (!shouldSend) {
      console.log(`[작업 종료] ${reason}`);
      return new Response(JSON.stringify({ message: reason }), { status: 200, headers: corsHeaders });
    }

    console.log(`[발송 시작] ${reason}`);

    // 4. 발송 대상 조회
    const { data: vendors } = await supabase.from('survey_vendors').select('*').eq('is_active', true);
    if (!vendors || vendors.length === 0) {
      return new Response(JSON.stringify({ message: "발송 대상 없음" }), { status: 200, headers: corsHeaders });
    }

    const API_KEY = Deno.env.get('SOLAPI_API_KEY');
    const API_SECRET = Deno.env.get('SOLAPI_SECRET');
    const SENDER_NO = Deno.env.get('SOLAPI_SENDER_NO');
    const PFID = Deno.env.get('SOLAPI_PFID');
    const TEMPLATE_ID = Deno.env.get('SOLAPI_TEMPLATE_ID');

    // 5. 순차 발송
    let success = 0;
    let fail = 0;

    for (const v of vendors) {
      const date = new Date().toISOString();
      const salt = Math.random().toString(36).substring(2, 12);
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", encoder.encode(API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sigBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(date + salt));
      const signature = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      const authHeader = `HMAC-SHA256 apiKey=${API_KEY}, date=${date}, salt=${salt}, signature=${signature}`;

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
              "#{url}": `https://survey-price-trend.pages.dev/input?key=${v.secret_key}`
            }
          }
        }
      };

      const res = await fetch("https://api.solapi.com/messages/v4/send", {
        method: "POST",
        headers: { "Authorization": authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        success++;
      } else {
        fail++;
        console.error(`[발송 실패] ${v.vendor_name}: HTTP ${res.status}`);
      }

      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`[발송 완료] 성공: ${success}, 실패: ${fail}`);
    return new Response(JSON.stringify({ message: "발송 완료", total: vendors.length, success, fail }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (err) {
    console.error("에러:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
})
