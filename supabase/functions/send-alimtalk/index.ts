// Supabase Edge Function: send-alimtalk
// 관리자 페이지에서 개별 업체에 알림톡을 수동 발송할 때 호출됨
// Body: { phone: string, url: string, vendorName: string, managerName: string }

const SOLAPI_API_URL = 'https://api.solapi.com/messages/v4/send'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS })
  }

  let body: { phone: string; url: string; vendorName: string; managerName: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS_HEADERS })
  }

  const { phone, url, vendorName, managerName } = body
  if (!phone || !url) {
    return Response.json({ error: 'phone and url are required' }, { status: 400, headers: CORS_HEADERS })
  }

  const apiKey     = Deno.env.get('SOLAPI_API_KEY')!
  const apiSecret  = Deno.env.get('SOLAPI_SECRET')!
  const senderNo   = Deno.env.get('SOLAPI_SENDER_NO')!
  const templateId = Deno.env.get('SOLAPI_TEMPLATE_ID')!
  const pfId       = Deno.env.get('SOLAPI_PFID')!

  const date = new Date().toISOString()
  const salt = Math.random().toString(36).substring(2, 11) + Date.now().toString(36)
  const signature = await hmacSha256(date + salt, apiSecret)
  const authHeader = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`

  const payload = {
    message: {
      to: phone.replace(/[^0-9]/g, ''),
      from: senderNo.replace(/[^0-9]/g, ''),
      kakaoOptions: {
        pfId,
        templateId,
        variables: {
          '#{url}': url,
          '#{vendor_name}': vendorName || '-',
          '#{manager_name}': managerName || '-',
        },
      },
    },
  }

  try {
    const response = await fetch(SOLAPI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const err = await response.json()
      return Response.json(
        { error: err.errorMessage || `HTTP ${response.status}` },
        { status: response.status, headers: CORS_HEADERS }
      )
    }

    return Response.json({ success: true }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('send-alimtalk 오류:', err)
    return Response.json({ error: String(err) }, { status: 500, headers: CORS_HEADERS })
  }
})
