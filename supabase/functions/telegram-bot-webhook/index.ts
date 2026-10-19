import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
    contact?: {
      phone_number: string;
    };
  };
}

async function sendTelegramMessage(chatId: number, text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
    }),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const update: TelegramUpdate = await req.json();

    console.log('Received Telegram update:', JSON.stringify(update));

    if (!update.message) {
      return new Response('OK', { status: 200, headers: corsHeaders });
    }

    const chatId = update.message.chat.id;
    const messageText = update.message.text?.trim();

    // Handle /start command
    if (messageText === '/start') {
      await sendTelegramMessage(
        chatId,
        '👋 Welcome to PharmaXpert!\n\n' +
        'To link your account, please share your registered phone number.\n\n' +
        'You can either:\n' +
        '1. Type your phone number (e.g., +251912345678)\n' +
        '2. Or use the "Share Contact" button below'
      );
      return new Response('OK', { status: 200, headers: corsHeaders });
    }

    // Handle phone number (both text and contact sharing)
    let phoneNumber: string | null = null;

    if (update.message.contact) {
      phoneNumber = update.message.contact.phone_number;
    } else if (messageText && messageText.match(/^\+?[\d\s()-]+$/)) {
      phoneNumber = messageText.replace(/[\s()-]/g, '');
    }

    if (phoneNumber) {
      console.log('Processing phone number:', phoneNumber);

      // Search for user with this phone number
      const { data: profiles, error: searchError } = await supabase
        .from('profiles')
        .select('id, full_name, phone_number')
        .eq('phone_number', phoneNumber);

      if (searchError) {
        console.error('Error searching profiles:', searchError);
        await sendTelegramMessage(
          chatId,
          '❌ An error occurred while searching for your account. Please try again later.'
        );
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      if (!profiles || profiles.length === 0) {
        await sendTelegramMessage(
          chatId,
          '❌ This phone number is not registered.\n\n' +
          'Please check your account details or contact your administrator.'
        );
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      // Update the profile with telegram chat ID
      const profile = profiles[0];
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ telegram_chat_id: chatId.toString() })
        .eq('id', profile.id);

      if (updateError) {
        console.error('Error updating profile:', updateError);
        await sendTelegramMessage(
          chatId,
          '❌ An error occurred while linking your account. Please try again later.'
        );
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      console.log(`Successfully linked account for ${profile.full_name}`);
      
      await sendTelegramMessage(
        chatId,
        `✅ Account linked successfully!\n\n` +
        `Welcome ${profile.full_name}! 🎉\n\n` +
        `You will now receive daily pharmacy reports at 10:00 PM.`
      );
    } else {
      await sendTelegramMessage(
        chatId,
        '❓ Please send a valid phone number or use /start to begin.'
      );
    }

    return new Response('OK', { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error('Error in telegram-bot-webhook:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});