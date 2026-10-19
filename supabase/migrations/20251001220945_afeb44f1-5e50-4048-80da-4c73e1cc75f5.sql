-- Create a function to get pharmacy owners with their emails
CREATE OR REPLACE FUNCTION public.get_owners_with_email()
RETURNS TABLE (
  id uuid,
  full_name text,
  email text,
  phone text,
  pharmacy_address text,
  active boolean,
  manually_deactivated boolean,
  role user_role
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    p.id,
    p.full_name,
    u.email,
    p.phone,
    p.pharmacy_address,
    p.active,
    p.manually_deactivated,
    p.role
  FROM public.profiles p
  INNER JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'owner';
$$;