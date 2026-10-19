-- Add foreign key constraint between pharmacy_branches and profiles
ALTER TABLE public.pharmacy_branches 
ADD CONSTRAINT pharmacy_branches_manager_staff_id_fkey 
FOREIGN KEY (manager_staff_id) 
REFERENCES public.profiles(id) 
ON DELETE SET NULL;