-- Add soft delete support to items table
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Add deleted items settings to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS show_deleted boolean DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_auto_cleanup_days integer DEFAULT 30;

-- Create index for faster deleted items queries
CREATE INDEX IF NOT EXISTS idx_items_deleted_at ON public.items(deleted_at) WHERE deleted_at IS NOT NULL;
