/*
# Add user preferences table and fix owner-column defaults

1. New Tables
- `user_preferences`
  - `id` (uuid, primary key)
  - `user_id` (uuid, not null, defaults to auth.uid(), references auth.users)
  - `preferences` (text, stores the AI-generated profile summary of the user's habits/communication style)
  - `updated_at` (timestamptz, auto-updated via trigger)
  - One row per user (unique on user_id)

2. Modified Tables
- `conversations`: alter `user_id` to `DEFAULT auth.uid()` so inserts that omit user_id succeed
- `messages`: alter `user_id` to `DEFAULT auth.uid()` for the same reason

3. Security
- Enable RLS on `user_preferences`
- Owner-scoped CRUD: authenticated users can only read/insert/update/delete their own preferences row
- 4 separate policies (select/insert/update/delete), scoped TO authenticated

4. Important Notes
- The DEFAULT auth.uid() changes ensure that frontend inserts like .insert({ title }) work without
  explicitly passing user_id, which would otherwise fail the RLS WITH CHECK.
- The user_preferences table stores a concise text summary of the user's communication habits,
  generated from their conversation history, which is injected into the AI system prompt.
*/

ALTER TABLE public.conversations ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.messages ALTER COLUMN user_id SET DEFAULT auth.uid();

CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid() UNIQUE,
  preferences TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_preferences" ON public.user_preferences;
CREATE POLICY "select_own_preferences" ON public.user_preferences
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_preferences" ON public.user_preferences;
CREATE POLICY "insert_own_preferences" ON public.user_preferences
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_preferences" ON public.user_preferences;
CREATE POLICY "update_own_preferences" ON public.user_preferences
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_preferences" ON public.user_preferences;
CREATE POLICY "delete_own_preferences" ON public.user_preferences
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO authenticated;
GRANT ALL ON public.user_preferences TO service_role;

DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON public.user_preferences;
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();