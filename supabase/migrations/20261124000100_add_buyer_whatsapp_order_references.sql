-- NOVAAI MARKET: readable order references and buyer-initiated WhatsApp confirmation.
-- No historical order references are fabricated. No WhatsApp messages or events are stored.
-- Existing UUID relationships, checkout validation and fulfilment rules remain unchanged.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_reference text;

ALTER TABLE public.seller_fulfillments
  ADD COLUMN IF NOT EXISTS seller_order_reference text;

-- The existing API grants are column-scoped; expose only the new reference fields.
-- Row-level security continues to control which order/fulfilment rows each user sees.
GRANT SELECT (order_reference) ON TABLE public.orders TO authenticated;
GRANT SELECT (seller_order_reference) ON TABLE public.seller_fulfillments TO authenticated;

CREATE SEQUENCE IF NOT EXISTS private.novaai_order_reference_seq
  AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS private.novaai_seller_order_reference_seq
  AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE UNIQUE INDEX IF NOT EXISTS orders_order_reference_unique
  ON public.orders (order_reference)
  WHERE order_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS seller_fulfillments_seller_order_reference_unique
  ON public.seller_fulfillments (seller_order_reference)
  WHERE seller_order_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION private.assign_novaai_order_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_year text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.order_reference IS DISTINCT FROM OLD.order_reference THEN
      RAISE EXCEPTION 'Order references are immutable.';
    END IF;
    RETURN NEW;
  END IF;
  v_year := to_char(clock_timestamp() AT TIME ZONE 'Africa/Johannesburg', 'YYYY');
  NEW.order_reference :=
    'NOVA-' || v_year || '-' ||
    lpad(nextval('private.novaai_order_reference_seq'::regclass)::text, 8, '0');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.assign_novaai_seller_order_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_year text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.seller_order_reference IS DISTINCT FROM OLD.seller_order_reference THEN
      RAISE EXCEPTION 'Seller order references are immutable.';
    END IF;
    RETURN NEW;
  END IF;
  v_year := to_char(clock_timestamp() AT TIME ZONE 'Africa/Johannesburg', 'YYYY');
  NEW.seller_order_reference :=
    'NOVA-S-' || v_year || '-' ||
    lpad(nextval('private.novaai_seller_order_reference_seq'::regclass)::text, 8, '0');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_novaai_assign_order_reference ON public.orders;
CREATE TRIGGER trg_novaai_assign_order_reference
BEFORE INSERT OR UPDATE OF order_reference ON public.orders
FOR EACH ROW
EXECUTE FUNCTION private.assign_novaai_order_reference();

DROP TRIGGER IF EXISTS trg_novaai_assign_seller_order_reference ON public.seller_fulfillments;
CREATE TRIGGER trg_novaai_assign_seller_order_reference
BEFORE INSERT OR UPDATE OF seller_order_reference ON public.seller_fulfillments
FOR EACH ROW
EXECUTE FUNCTION private.assign_novaai_seller_order_reference();

REVOKE ALL ON FUNCTION private.assign_novaai_order_reference() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.assign_novaai_seller_order_reference() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.novaai_order_reference_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.novaai_seller_order_reference_seq FROM PUBLIC, anon, authenticated;

-- Buyer-only confirmation payload. It omits delivery_address and scopes each
-- product list to the matching seller fulfilment and seller ID.
CREATE OR REPLACE FUNCTION public.get_buyer_order_whatsapp_details(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Please sign in to view this order.';
  END IF;

  SELECT *
    INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND customer_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found for this signed-in customer.';
  END IF;

  IF v_order.order_reference IS NULL THEN
    RAISE EXCEPTION 'This order does not have a readable reference.';
  END IF;

  SELECT jsonb_build_object(
    'order_reference', v_order.order_reference,
    'buyer', jsonb_build_object(
      'name', v_order.customer_name,
      'phone', v_order.customer_phone
    ),
    'sellers', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'seller_order_reference', sf.seller_order_reference,
            'store_name', ss.store_name,
            'phone', ss.phone,
            'items', COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'product_name', oi.product_name,
                    'quantity', oi.quantity
                  )
                  ORDER BY oi.created_at, oi.id
                )
                FROM public.order_items oi
                WHERE oi.order_id = v_order.id
                  AND oi.fulfillment_id = sf.id
                  AND oi.seller_id = sf.seller_id
              ),
              '[]'::jsonb
            )
          )
          ORDER BY ss.store_name, sf.id
        )
        FROM public.seller_fulfillments sf
        JOIN public.seller_stores ss
          ON ss.user_id = sf.seller_id
        WHERE sf.order_id = v_order.id
      ),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_buyer_order_whatsapp_details(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_buyer_order_whatsapp_details(uuid)
  TO authenticated;
