-- NOVAAI MARKET: readable order references and buyer-initiated WhatsApp confirmation.
-- No WhatsApp messages, events, send states, delivery receipts, or message history are stored.
-- Existing order UUIDs and historical records remain unchanged; historical references stay NULL.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_reference text;
ALTER TABLE public.seller_fulfillments ADD COLUMN IF NOT EXISTS seller_order_reference text;

CREATE SEQUENCE IF NOT EXISTS public.novaai_order_reference_seq
  AS bigint START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS public.novaai_seller_order_reference_seq
  AS bigint START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE UNIQUE INDEX IF NOT EXISTS orders_order_reference_uidx
  ON public.orders (order_reference) WHERE order_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS seller_fulfillments_seller_order_reference_uidx
  ON public.seller_fulfillments (seller_order_reference) WHERE seller_order_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_novaai_order_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_year text; v_number bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.order_reference IS DISTINCT FROM OLD.order_reference THEN
      RAISE EXCEPTION 'NOVAAI order references are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.order_reference IS NULL THEN
    v_year := pg_catalog.to_char(pg_catalog.clock_timestamp() AT TIME ZONE 'Africa/Johannesburg', 'YYYY');
    v_number := pg_catalog.nextval('public.novaai_order_reference_seq'::pg_catalog.regclass);
    NEW.order_reference := 'NOVA-' || v_year || '-' || pg_catalog.lpad(v_number::text, 8, '0');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_novaai_seller_order_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_year text; v_number bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.seller_order_reference IS DISTINCT FROM OLD.seller_order_reference THEN
      RAISE EXCEPTION 'NOVAAI seller order references are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.seller_order_reference IS NULL THEN
    v_year := pg_catalog.to_char(pg_catalog.clock_timestamp() AT TIME ZONE 'Africa/Johannesburg', 'YYYY');
    v_number := pg_catalog.nextval('public.novaai_seller_order_reference_seq'::pg_catalog.regclass);
    NEW.seller_order_reference := 'NOVA-S-' || v_year || '-' || pg_catalog.lpad(v_number::text, 8, '0');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_assign_novaai_order_reference ON public.orders;
CREATE TRIGGER trg_assign_novaai_order_reference
BEFORE INSERT OR UPDATE OF order_reference ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.assign_novaai_order_reference();

DROP TRIGGER IF EXISTS trg_assign_novaai_seller_order_reference ON public.seller_fulfillments;
CREATE TRIGGER trg_assign_novaai_seller_order_reference
BEFORE INSERT OR UPDATE OF seller_order_reference ON public.seller_fulfillments
FOR EACH ROW EXECUTE FUNCTION public.assign_novaai_seller_order_reference();

-- Only the authenticated buyer who owns this order can retrieve its seller-specific
-- WhatsApp-ready rows. The buyer's full delivery address is deliberately excluded.
CREATE OR REPLACE FUNCTION public.get_my_order_whatsapp_confirmation(p_order_id uuid)
RETURNS TABLE (
  order_reference text,
  seller_order_reference text,
  seller_id uuid,
  store_name text,
  seller_phone text,
  items jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT
    o.order_reference,
    sf.seller_order_reference,
    sf.seller_id,
    s.store_name,
    s.phone,
    COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('product_name', oi.product_name, 'quantity', oi.quantity)
        ORDER BY oi.product_name
      ) FILTER (WHERE oi.id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM public.orders AS o
  JOIN public.seller_fulfillments AS sf ON sf.order_id = o.id
  LEFT JOIN public.seller_stores AS s ON s.user_id = sf.seller_id
  LEFT JOIN public.order_items AS oi
    ON oi.order_id = o.id
   AND oi.fulfillment_id = sf.id
   AND oi.seller_id = sf.seller_id
  WHERE o.id = p_order_id
    AND o.customer_id = (SELECT auth.uid())
  GROUP BY o.order_reference, sf.seller_order_reference, sf.seller_id, s.store_name, s.phone
  ORDER BY s.store_name;
$function$;

REVOKE ALL ON FUNCTION public.get_my_order_whatsapp_confirmation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_order_whatsapp_confirmation(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.assign_novaai_order_reference() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_novaai_seller_order_reference() FROM PUBLIC, anon, authenticated;
