-- This function is attached to seller_public_locations as a trigger.
-- Client roles do not need direct EXECUTE permission to fire the trigger.
REVOKE EXECUTE ON FUNCTION public.enforce_seller_public_location_workflow()
FROM PUBLIC, anon, authenticated;
