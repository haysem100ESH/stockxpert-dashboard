-- Create subscription and branch management tables

-- Create subscription status enum
CREATE TYPE subscription_status AS ENUM ('active', 'expiring_soon', 'expired');

-- Create payment status enum  
CREATE TYPE payment_status AS ENUM ('pending', 'approved', 'declined');

-- Create pharmacy_subscriptions table
CREATE TABLE public.pharmacy_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pharmacy_owner_id UUID NOT NULL,
  subscription_credit INTEGER NOT NULL DEFAULT 30, -- days remaining
  status subscription_status NOT NULL DEFAULT 'active',
  deposit_amount DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_credit_deduction DATE DEFAULT CURRENT_DATE
);

-- Create pharmacy_branches table
CREATE TABLE public.pharmacy_branches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pharmacy_owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  manager_staff_id UUID,
  is_main_branch BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create payment_requests table
CREATE TABLE public.payment_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pharmacy_owner_id UUID NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  months_requested INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  transaction_reference TEXT,
  status payment_status NOT NULL DEFAULT 'pending',
  approved_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add branch_id to existing tables to support multi-branch
ALTER TABLE public.medicines ADD COLUMN branch_id UUID;
ALTER TABLE public.sales ADD COLUMN branch_id UUID;  
ALTER TABLE public.expenses ADD COLUMN branch_id UUID;
ALTER TABLE public.suppliers ADD COLUMN branch_id UUID;

-- Enable RLS on new tables
ALTER TABLE public.pharmacy_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;