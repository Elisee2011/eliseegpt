-- Credits balance
CREATE TABLE public.user_credits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance numeric(12,2) NOT NULL DEFAULT 10 CHECK (balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_credits TO authenticated;
GRANT ALL ON public.user_credits TO service_role;
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own credits" ON public.user_credits FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER update_user_credits_updated_at BEFORE UPDATE ON public.user_credits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Ledger
CREATE TABLE public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta numeric(12,2) NOT NULL,
  reason text NOT NULL,
  ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credit_ledger_ref_unique ON public.credit_ledger (ref) WHERE ref IS NOT NULL;
CREATE INDEX credit_ledger_user_created ON public.credit_ledger (user_id, created_at DESC);
GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT ALL ON public.credit_ledger TO service_role;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own ledger" ON public.credit_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Payment orders
CREATE TABLE public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'XOF',
  credits numeric(12,2) NOT NULL CHECK (credits > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled')),
  provider text NOT NULL DEFAULT 'kkiapay',
  provider_transaction_id text UNIQUE,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX payment_orders_user_created ON public.payment_orders (user_id, created_at DESC);
GRANT SELECT ON public.payment_orders TO authenticated;
GRANT ALL ON public.payment_orders TO service_role;
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own orders" ON public.payment_orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER update_payment_orders_updated_at BEFORE UPDATE ON public.payment_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Ensure a balance row exists
CREATE OR REPLACE FUNCTION public.ensure_user_credits(_user_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _balance numeric;
BEGIN
  INSERT INTO public.user_credits (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT balance INTO _balance FROM public.user_credits WHERE user_id = _user_id;
  RETURN _balance;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_user_credits(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_user_credits(uuid) TO service_role;

-- Spend credits atomically
CREATE OR REPLACE FUNCTION public.spend_credits(_user_id uuid, _amount numeric, _reason text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _balance numeric;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  PERFORM public.ensure_user_credits(_user_id);
  SELECT balance INTO _balance FROM public.user_credits WHERE user_id = _user_id FOR UPDATE;
  IF _balance < _amount THEN RAISE EXCEPTION 'insufficient_credits'; END IF;
  UPDATE public.user_credits SET balance = balance - _amount WHERE user_id = _user_id
  RETURNING balance INTO _balance;
  INSERT INTO public.credit_ledger (user_id, delta, reason) VALUES (_user_id, -_amount, _reason);
  RETURN _balance;
END;
$$;
REVOKE ALL ON FUNCTION public.spend_credits(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spend_credits(uuid, numeric, text) TO service_role;

-- Refund credits (used when the AI call fails after a debit)
CREATE OR REPLACE FUNCTION public.refund_credits(_user_id uuid, _amount numeric, _reason text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _balance numeric;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  PERFORM public.ensure_user_credits(_user_id);
  UPDATE public.user_credits SET balance = balance + _amount WHERE user_id = _user_id
  RETURNING balance INTO _balance;
  INSERT INTO public.credit_ledger (user_id, delta, reason) VALUES (_user_id, _amount, _reason);
  RETURN _balance;
END;
$$;
REVOKE ALL ON FUNCTION public.refund_credits(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid, numeric, text) TO service_role;

-- Settle a verified payment exactly once
CREATE OR REPLACE FUNCTION public.settle_payment(_order_id uuid, _transaction_id text, _paid_amount integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _order public.payment_orders; _balance numeric;
BEGIN
  SELECT * INTO _order FROM public.payment_orders WHERE id = _order_id FOR UPDATE;
  IF _order IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unknown_order'); END IF;
  IF _order.status = 'paid' THEN
    SELECT balance INTO _balance FROM public.user_credits WHERE user_id = _order.user_id;
    RETURN jsonb_build_object('ok', true, 'already_credited', true, 'credits', _order.credits, 'balance', _balance);
  END IF;
  IF _paid_amount < _order.amount THEN
    UPDATE public.payment_orders SET status = 'failed', failure_reason = 'amount_mismatch' WHERE id = _order_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  END IF;

  UPDATE public.payment_orders
    SET status = 'paid', provider_transaction_id = _transaction_id, paid_at = now(), failure_reason = NULL
    WHERE id = _order_id;

  PERFORM public.ensure_user_credits(_order.user_id);
  INSERT INTO public.credit_ledger (user_id, delta, reason, ref)
    VALUES (_order.user_id, _order.credits, 'purchase:' || _order.pack, 'kkiapay:' || _transaction_id);
  UPDATE public.user_credits SET balance = balance + _order.credits WHERE user_id = _order.user_id
    RETURNING balance INTO _balance;

  RETURN jsonb_build_object('ok', true, 'already_credited', false, 'credits', _order.credits, 'balance', _balance);
EXCEPTION WHEN unique_violation THEN
  SELECT balance INTO _balance FROM public.user_credits WHERE user_id = _order.user_id;
  RETURN jsonb_build_object('ok', true, 'already_credited', true, 'credits', _order.credits, 'balance', _balance);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_payment(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_payment(uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_order(_order_id uuid, _status text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payment_orders
    SET status = _status, failure_reason = _reason
    WHERE id = _order_id AND status = 'pending' AND _status IN ('failed','cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.fail_order(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fail_order(uuid, text, text) TO service_role;