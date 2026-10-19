# Telegram Bot Integration for PharmaXpert

This document explains how to set up and use the Telegram bot integration for automated daily reports.

## Features

- ✅ Link pharmacy owner accounts to Telegram
- ✅ Automated daily reports sent at 10:00 PM
- ✅ Detailed sales and financial analytics
- ✅ Top-selling medicines tracking
- ✅ Payment method breakdown
- ✅ Low stock alerts

## Setup Instructions

### 1. Bot Token Configuration

The Telegram bot token has been securely stored as `TELEGRAM_BOT_TOKEN` in your Cloud secrets.

### 2. Set Up Telegram Webhook

You need to configure the webhook to connect Telegram to your bot:

**Option A: Using the setup function**
Call the setup function manually:
```bash
curl -X POST https://tcqlsxmgazrftpbumauk.supabase.co/functions/v1/setup-telegram-webhook
```

**Option B: Manual webhook setup**
Visit this URL in your browser (replace YOUR_TOKEN with your actual token):
```
https://api.telegram.org/bot8472949387:AAHT2LarOiE9vJcRk0-A9elfFjhE36GIV-4/setWebhook?url=https://tcqlsxmgazrftpbumauk.supabase.co/functions/v1/telegram-bot-webhook
```

### 3. Add Phone Numbers to Owner Accounts

When creating a new pharmacy owner:
1. Go to Developer Portal
2. Click "Create Owner Account"
3. Fill in the phone number field (e.g., +251912345678)
4. The phone number will be saved to the profile

### 4. Link Telegram Account

For owners to receive reports:
1. Search for your bot on Telegram (use the bot username from @BotFather)
2. Send `/start` to the bot
3. Share your registered phone number
4. The bot will confirm the link

## Daily Report Schedule

Reports are sent automatically at 10:00 PM daily via Supabase Cron.

### To Set Up the Cron Job:

Run this SQL in your Supabase SQL Editor:

```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule the daily report at 10:00 PM
SELECT cron.schedule(
  'telegram-daily-reports',
  '0 22 * * *', -- 10:00 PM daily
  $$
  SELECT
    net.http_post(
        url:='https://tcqlsxmgazrftpbumauk.supabase.co/functions/v1/telegram-daily-report',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjcWxzeG1nYXpyZnRwYnVtYXVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYyODk0ODEsImV4cCI6MjA3MTg2NTQ4MX0.BZd-jIdwMVCn2AdKEl5QU6qgcFMrhgpp2SO3e2NXS20"}'::jsonb,
        body:=concat('{"time": "', now(), '"}')::jsonb
    ) as request_id;
  $$
);
```

### To Test the Report Manually:

```bash
curl -X POST https://tcqlsxmgazrftpbumauk.supabase.co/functions/v1/telegram-daily-report
```

## Report Format

The daily report includes:

```
📊 *Daily Pharmacy Report*
📅 [Date]

💰 *Total Income:* XXX ETB
🧾 *Transactions:* X

💊 *Top Medicines:*
1. Medicine Name (X units)
2. Medicine Name (X units)
3. Medicine Name (X units)

💳 *Payment Breakdown:*
💵 Cash: XXX ETB
💳 Card: XXX ETB
📝 Credit: XXX ETB

⚠️ *Stock Alerts:* X items running low
```

## Troubleshooting

### Bot Not Responding
1. Check if webhook is set up correctly
2. View logs in Supabase Edge Functions dashboard
3. Verify TELEGRAM_BOT_TOKEN is correct

### Reports Not Sending
1. Verify cron job is scheduled
2. Check that owners have telegram_chat_id set
3. Review telegram-daily-report function logs

### Phone Number Not Linking
1. Ensure phone number format matches exactly
2. Check profiles table has phone_number column
3. Verify the phone number exists in the database

## Database Schema

The integration uses these fields in the `profiles` table:
- `phone_number` (TEXT): The owner's phone number
- `telegram_chat_id` (TEXT): The Telegram chat ID for sending messages

## Edge Functions

Three edge functions power this integration:

1. **telegram-bot-webhook**: Handles incoming Telegram messages
2. **telegram-daily-report**: Generates and sends daily reports
3. **setup-telegram-webhook**: One-time webhook configuration

All functions are deployed automatically with your project.