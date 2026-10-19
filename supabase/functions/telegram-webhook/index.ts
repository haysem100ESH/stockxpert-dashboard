import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TelegramUpdate {
  message?: {
    chat: {
      id: number;
    };
    text?: string;
  };
}

// Helper function to send Telegram messages
async function sendMessage(chatId: number, text: string): Promise<void> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Telegram API error:', error);
    }
  } catch (error) {
    console.error('Error sending Telegram message:', error);
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const update: TelegramUpdate = await req.json();

    console.log('Received Telegram update:', JSON.stringify(update));

    if (!update.message?.text) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const chatId = update.message.chat.id;
    const messageText = update.message.text;

    // Check if message starts with /start
    if (messageText.startsWith('/start')) {
      // Extract owner_id from command (format: /start owner_id)
      const parts = messageText.split(' ');
      
      if (parts.length === 1) {
        // No owner_id provided
        await sendMessage(
          chatId,
          '👋 Welcome to PharmaXpert Bot!\n\n' +
          'To connect your account, please click the "Connect Telegram" button from your owner dashboard.\n\n' +
          'You will be redirected here with the correct link to complete the connection.'
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      const ownerId = parts[1];

      // Validate owner_id format (should be a UUID)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(ownerId)) {
        await sendMessage(
          chatId,
          '❌ Invalid connection link. Please use the "Connect Telegram" button from your dashboard to get a valid connection link.'
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      // Check if owner exists and is an owner role
      const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('id, full_name, role, telegram_chat_id')
        .eq('id', ownerId)
        .single();

      if (fetchError || !profile) {
        console.error('Error fetching profile:', fetchError);
        await sendMessage(
          chatId,
          '❌ Account not found. Please make sure you\'re using the correct connection link from your dashboard.'
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      if (profile.role !== 'owner') {
        await sendMessage(
          chatId,
          '❌ This feature is only available for pharmacy owners. Please contact your administrator.'
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      // Check if already connected
      if (profile.telegram_chat_id) {
        await sendMessage(
          chatId,
          '✅ Your Telegram account is already connected!\n\n' +
          `Welcome back, ${profile.full_name}! You will continue receiving your daily pharmacy reports here at 10:00 PM.`
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      // Update profile with telegram_chat_id
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ telegram_chat_id: chatId.toString() })
        .eq('id', ownerId);

      if (updateError) {
        console.error('Error updating profile:', updateError);
        await sendMessage(
          chatId,
          '❌ Failed to connect your account. Please try again or contact support.'
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      // Send success message
      await sendMessage(
        chatId,
        `✅ *Telegram Connected Successfully!*\n\n` +
        `Welcome, ${profile.full_name}! 🎉\n\n` +
        `You will now receive:\n` +
        `📊 Daily pharmacy reports at 10:00 PM\n` +
        `💰 Sales and income summaries\n` +
        `💊 Top-selling medicines\n` +
        `⚠️ Low stock alerts\n` +
        `📈 Financial analytics\n\n` +
        `Stay informed about your pharmacy's performance! 🚀`
      );

      console.log(`Successfully connected Telegram for owner ${ownerId}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error processing Telegram webhook:', error);
    return new Response(
      JSON.stringify({ ok: true }), // Return 200 to prevent Telegram retries
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  }
});
