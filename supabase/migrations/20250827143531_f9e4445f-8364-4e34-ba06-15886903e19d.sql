-- Create function to get profile by email for password recovery
CREATE OR REPLACE FUNCTION public.get_profile_by_email(user_email TEXT)
RETURNS TABLE(
  id UUID,
  full_name TEXT,
  role user_role,
  phone TEXT,
  security_question TEXT,
  security_answer_hash TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.role, p.phone, p.security_question, p.security_answer_hash, p.created_at, p.updated_at
  FROM public.profiles p
  INNER JOIN auth.users u ON u.id = p.id
  WHERE u.email = user_email;
$$;