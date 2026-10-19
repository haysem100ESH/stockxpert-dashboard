import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting daily credit deduction process...');

    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];

    // Get all active subscriptions that haven't been deducted today
    const { data: subscriptions, error: fetchError } = await supabaseClient
      .from('pharmacy_subscriptions')
      .select('*')
      .or(`last_credit_deduction.is.null,last_credit_deduction.neq.${today}`)
      .gt('subscription_credit', 0);

    if (fetchError) {
      console.error('Error fetching subscriptions:', fetchError);
      throw fetchError;
    }

    console.log(`Found ${subscriptions?.length || 0} subscriptions to process`);

    let processedCount = 0;
    let errorCount = 0;

    // Process each subscription
    for (const subscription of subscriptions || []) {
      try {
        const newCredit = Math.max(0, subscription.subscription_credit - 1);
        let newStatus: 'active' | 'expiring_soon' | 'expired';

        if (newCredit <= 0) {
          newStatus = 'expired';
        } else if (newCredit <= 7) { // 7 days or less = expiring soon
          newStatus = 'expiring_soon';
        } else {
          newStatus = 'active';
        }

        console.log(`Processing subscription ${subscription.id}: ${subscription.subscription_credit} -> ${newCredit} (${newStatus})`);

        const { error: updateError } = await supabaseClient
          .from('pharmacy_subscriptions')
          .update({
            subscription_credit: newCredit,
            status: newStatus,
            last_credit_deduction: today
          })
          .eq('id', subscription.id);

        if (updateError) {
          console.error(`Error updating subscription ${subscription.id}:`, updateError);
          errorCount++;
        } else {
          processedCount++;
        }
      } catch (error) {
        console.error(`Error processing subscription ${subscription.id}:`, error);
        errorCount++;
      }
    }

    console.log(`Credit deduction complete: ${processedCount} processed, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Daily credit deduction completed`,
        processed: processedCount,
        errors: errorCount,
        date: today
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in daily credit deduction:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Unknown error occurred'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});