-- Enable required extensions for cron jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create a cron job to run daily credit deduction at midnight UTC
SELECT cron.schedule(
  'daily-subscription-credit-deduction',
  '0 0 * * *', -- At midnight UTC every day
  $$
  SELECT
    net.http_post(
      url:='https://tcqlsxmgazrftpbumauk.supabase.co/functions/v1/daily-credit-deduction',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjcWxzeG1nYXpyZnRwYnVtYXVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYyODk0ODEsImV4cCI6MjA3MTg2NTQ4MX0.BZd-jIdwMVCn2AdKEl5QU6qgcFMrhgpp2SO3e2NXS20"}'::jsonb,
      body:='{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);