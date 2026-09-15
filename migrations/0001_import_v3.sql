-- V3 staging is independent of the existing Gmail/import/flight tables.
CREATE TABLE IF NOT EXISTS v3_raw_sources (
  id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  source_kind TEXT NOT NULL, source_ref TEXT, parent_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_v3_raw_sha ON v3_raw_sources(sha256);
CREATE TABLE IF NOT EXISTS v3_source_links (
  source_id TEXT NOT NULL, source_kind TEXT NOT NULL, source_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_id,source_kind,source_ref)
);
CREATE TABLE IF NOT EXISTS v3_extracted_documents (
  source_id TEXT PRIMARY KEY, format TEXT NOT NULL, text_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS v3_decisions (
  source_id TEXT PRIMARY KEY, identity_json TEXT NOT NULL,
  classification_json TEXT NOT NULL, interpreter_json TEXT NOT NULL,
  status TEXT NOT NULL, issues_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS v3_flight_batches (
  batch_id TEXT PRIMARY KEY, flight_identity TEXT NOT NULL,
  source_ids_json TEXT NOT NULL, consolidated_json TEXT NOT NULL,
  validation_json TEXT NOT NULL, comparison_json TEXT NOT NULL,
  status TEXT NOT NULL, applied_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_v3_batch_flight ON v3_flight_batches(flight_identity,status);
