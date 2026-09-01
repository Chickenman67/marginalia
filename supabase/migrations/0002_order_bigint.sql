-- items.order is used as a "created at" tie-breaker via Date.now(); integer
-- overflows once timestamps exceed ~2^31 ms (year 2038 boundary). Use bigint
-- to match the time source.
ALTER TABLE public.items ALTER COLUMN "order" TYPE bigint USING "order"::bigint;
