-- seats.io: event key estable por mapa (renderer usa `event`, no solo `chart`).
ALTER TABLE mapa_asiento
  ADD COLUMN IF NOT EXISTS seatsio_event_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mapa_asiento_seatsio_event_key
  ON mapa_asiento (seatsio_event_key)
  WHERE seatsio_event_key IS NOT NULL;
