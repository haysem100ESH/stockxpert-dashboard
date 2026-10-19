const TELEGRAM_BOT_TOKEN_ADMIN = Deno.env.get('TELEGRAM_BOT_TOKEN_ADMIN');
const ADMIN_CHAT_IDS = ['1447176624', '1447176623'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function sendTelegramPhoto(chatId: string, photoBase64: string, caption: string, fileName: string): Promise<void> {
  const binaryString = atob(photoBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('caption', caption);
  formData.append('parse_mode', 'Markdown');
  formData.append('photo', new Blob([bytes], { type: 'image/jpeg' }), fileName);

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN_ADMIN}/sendPhoto`;
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Telegram sendPhoto error: ${JSON.stringify(err)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!TELEGRAM_BOT_TOKEN_ADMIN) {
      throw new Error('TELEGRAM_BOT_TOKEN_ADMIN is not defined');
    }

    const { amount, ownerName, ownerEmail, receiptBase64, fileName } = await req.json();

    if (!amount || !receiptBase64) {
      return new Response(
        JSON.stringify({ error: 'Missing amount or receipt image' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const caption = `💰 *Payment Receipt Received*\n\n👤 *Owner:* ${ownerName || 'N/A'}\n📧 *Email:* ${ownerEmail || 'N/A'}\n💵 *Amount:* ${amount} ETB\n📅 *Date:* ${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}\n\n_Please verify and activate the subscription._`;

    for (const chatId of ADMIN_CHAT_IDS) {
      await sendTelegramPhoto(chatId, receiptBase64, caption, fileName || 'receipt.jpg');
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Payment receipt sent to admin' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-payment-receipt:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
