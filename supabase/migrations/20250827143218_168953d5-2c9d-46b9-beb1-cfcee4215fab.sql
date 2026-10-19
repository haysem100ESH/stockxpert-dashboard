-- Add security question and answer to profiles table
ALTER TABLE public.profiles 
ADD COLUMN security_question TEXT,
ADD COLUMN security_answer_hash TEXT;