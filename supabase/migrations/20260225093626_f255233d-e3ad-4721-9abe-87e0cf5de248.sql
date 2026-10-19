
DROP POLICY "Authenticated users can insert credit logs" ON public.credit_logs;
CREATE POLICY "Authenticated users can insert credit logs" ON public.credit_logs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
