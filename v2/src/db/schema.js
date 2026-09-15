// Schéma D1 centralisé pour ALYZIA OPS v2.
//
// Toutes les tables sont reprises de l'application actuelle (v1,
// src/index.js) où elles étaient créées par des fonctions ensure*Tables
// éparpillées dans tout le fichier. Ici, un seul endroit, une seule liste.
//
// 17 tables ont une définition CREATE TABLE explicite en v1 (colonnes
// copiées verbatim). 5 tables sont utilisées en v1 (INSERT/SELECT réels)
// mais n'ont jamais eu de CREATE TABLE dans l'historique git du dépôt —
// elles ont été créées manuellement en base à un moment donné. Leur
// définition ci-dessous est reconstruite à partir de tous les usages
// réels trouvés dans le code (colonnes lues/écrites), pas devinée :
// FLIGHTS, AIRLINE_PROFILES, FLIGHT_NOTES, FLIGHT_ATTACHMENTS, PREPA_INBOX
// (voir le commentaire "RECONSTRUITE" sur chacune).

const STATEMENTS = [
  // ---- Vols (RECONSTRUITE — pas de CREATE TABLE en v1) ----
  // Une fiche de vol entière est stockée en JSON dans data_json (v1 évite
  // le coût CPU d'un JSON.parse/stringify systématique sur de grosses
  // fiches). identity = "date|AIRLINE|FLIGHT".
  `CREATE TABLE IF NOT EXISTS flights (
    identity TEXT PRIMARY KEY,
    flight_date TEXT NOT NULL,
    airline TEXT NOT NULL,
    flight_number TEXT NOT NULL,
    std TEXT,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_flights_date_std
   ON flights(flight_date, std, flight_number)`,

  // ---- Profils compagnie (RECONSTRUITE) ----
  `CREATE TABLE IF NOT EXISTS airline_profiles (
    airline TEXT PRIMARY KEY,
    import_mode TEXT NOT NULL DEFAULT 'GENERIC',
    visible_kpis_json TEXT NOT NULL DEFAULT '{}',
    visible_cards_json TEXT NOT NULL DEFAULT '{}',
    notes_enabled INTEGER NOT NULL DEFAULT 1,
    attachments_enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // ---- Notes et pièces jointes de fiche vol (RECONSTRUITES) ----
  `CREATE TABLE IF NOT EXISTS flight_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flight_identity TEXT NOT NULL,
    airline TEXT NOT NULL,
    note_type TEXT NOT NULL DEFAULT 'COMPANY',
    content TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_flight_notes_identity
   ON flight_notes(flight_identity, created_at, id)`,

  `CREATE TABLE IF NOT EXISTS flight_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flight_identity TEXT NOT NULL,
    airline TEXT NOT NULL,
    note_id INTEGER,
    file_name TEXT NOT NULL,
    original_file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    r2_key TEXT NOT NULL,
    uploaded_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_flight_attachments_identity
   ON flight_attachments(flight_identity, created_at, id)`,

  // ---- Contrôle PREPA (v1: ensurePrepaControlTables) ----
  `CREATE TABLE IF NOT EXISTS app_integrations (
    integration_key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS prepa_suppressed_flights (
    airline TEXT NOT NULL,
    flight_number TEXT NOT NULL,
    flight_date TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (airline, flight_number, flight_date)
  )`,
  `CREATE TABLE IF NOT EXISTS prepa_suppressed_messages (
    gmail_message_id TEXT PRIMARY KEY,
    airline TEXT,
    flight_number TEXT,
    flight_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // ---- Boîte PREPA (RECONSTRUITE) ----
  `CREATE TABLE IF NOT EXISTS prepa_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gmail_message_id TEXT NOT NULL UNIQUE,
    gmail_thread_id TEXT,
    source TEXT NOT NULL DEFAULT 'GMAIL',
    airline TEXT,
    flight_number TEXT,
    flight_date TEXT,
    subject TEXT,
    sender TEXT,
    received_at TEXT,
    body_text TEXT,
    drive_folder_id TEXT,
    drive_email_pdf_id TEXT,
    attachments_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'PENDING',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prepa_inbox_status_received
   ON prepa_inbox(status, received_at)`,
  `CREATE INDEX IF NOT EXISTS idx_prepa_inbox_flight
   ON prepa_inbox(airline, flight_number, flight_date)`,

  // ---- Ingestion Gmail (v1: ensureGmailPipelineTables) ----
  `CREATE TABLE IF NOT EXISTS gmail_sync_state (
    mailbox TEXT PRIMARY KEY,
    last_history_id TEXT,
    last_full_sync_at TEXT,
    last_realtime_sync_at TEXT,
    backfill_query TEXT,
    backfill_page_token TEXT,
    backfill_status TEXT NOT NULL DEFAULT 'IDLE',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS gmail_messages (
    gmail_message_id TEXT PRIMARY KEY,
    gmail_thread_id TEXT,
    history_id TEXT,
    internal_date TEXT,
    subject TEXT,
    sender TEXT,
    received_at TEXT,
    snippet TEXT,
    label_state TEXT,
    airline TEXT,
    flight_number TEXT,
    flight_date TEXT,
    status TEXT NOT NULL DEFAULT 'RECEIVED',
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS import_files (
    file_id TEXT PRIMARY KEY,
    active_version_id TEXT,
    airline TEXT,
    flight_number TEXT,
    flight_date TEXT,
    document_type TEXT,
    filename_normalized TEXT,
    status TEXT NOT NULL DEFAULT 'RECEIVED',
    latest_document_time TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    retention_status TEXT NOT NULL DEFAULT 'ACTIVE',
    locked_until TEXT,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS import_file_versions (
    version_id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    gmail_message_id TEXT,
    attachment_id TEXT,
    filename_original TEXT,
    filename_normalized TEXT,
    mime_type TEXT,
    file_size INTEGER,
    sha256 TEXT,
    r2_key TEXT,
    document_time TEXT,
    received_at TEXT,
    status TEXT NOT NULL DEFAULT 'STORED',
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS gmail_message_documents (
    gmail_message_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    source_kind TEXT NOT NULL DEFAULT 'ATTACHMENT',
    source_ref TEXT,
    parent_version_id TEXT,
    is_duplicate INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (gmail_message_id, version_id, source_kind, source_ref)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_gmail_message_documents_message
   ON gmail_message_documents(gmail_message_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS import_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    airline TEXT,
    flight_number TEXT,
    flight_date TEXT,
    gmail_message_id TEXT,
    file_id TEXT,
    version_id TEXT,
    change_type TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS import_jobs (
    job_id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 50,
    airline TEXT,
    flight_number TEXT,
    flight_date TEXT,
    file_id TEXT,
    version_id TEXT,
    gmail_message_id TEXT,
    status TEXT NOT NULL DEFAULT 'QUEUED',
    attempts INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    run_after TEXT
  )`,

  // ---- Résultats de classification (v1: ensureImportProcessorTables) ----
  `CREATE TABLE IF NOT EXISTS import_job_results (
    job_id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    airline TEXT,
    flight_number TEXT,
    flight_date TEXT,
    parser_mode TEXT,
    document_type TEXT,
    list_name TEXT,
    card_key TEXT,
    passenger_count INTEGER,
    class_counts_json TEXT,
    extracted_text_preview TEXT,
    result_json TEXT,
    status TEXT NOT NULL DEFAULT 'CLASSIFIED',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_import_job_results_flight
   ON import_job_results(airline, flight_number, flight_date, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_import_job_results_version
   ON import_job_results(version_id)`,

  // ---- Injection vers fiche vol (v1: ensureLot3Tables) ----
  `CREATE TABLE IF NOT EXISTS flight_import_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identity TEXT NOT NULL,
    airline TEXT NOT NULL,
    flight_number TEXT NOT NULL,
    flight_date TEXT NOT NULL,
    card_key TEXT NOT NULL,
    list_name TEXT NOT NULL DEFAULT '',
    source_status TEXT NOT NULL DEFAULT 'ACTIVE',
    passenger_count INTEGER NOT NULL DEFAULT 0,
    class_counts_json TEXT NOT NULL DEFAULT '{}',
    version_id TEXT,
    file_id TEXT,
    job_id TEXT,
    result_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(identity, card_key, list_name, version_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_flight_import_cards_identity
   ON flight_import_cards(identity, card_key, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_flight_import_cards_flight
   ON flight_import_cards(airline, flight_number, flight_date)`,
  `CREATE TABLE IF NOT EXISTS flight_import_injections (
    result_job_id TEXT PRIMARY KEY,
    identity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'INJECTED',
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // ---- Orchestration autopilot / archivage Drive (v1: ensureLot5Tables) ----
  `CREATE TABLE IF NOT EXISTS lot5_autopilot_runs (
    run_id TEXT PRIMARY KEY,
    trigger_type TEXT NOT NULL DEFAULT 'CRON',
    status TEXT NOT NULL DEFAULT 'RUNNING',
    gmail_processed INTEGER NOT NULL DEFAULT 0,
    jobs_processed INTEGER NOT NULL DEFAULT 0,
    results_injected INTEGER NOT NULL DEFAULT 0,
    drive_files_uploaded INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS lot5_drive_folders (
    identity TEXT PRIMARY KEY,
    airline TEXT NOT NULL,
    flight_number TEXT NOT NULL,
    flight_date TEXT NOT NULL,
    airline_folder_id TEXT,
    date_folder_id TEXT,
    flight_folder_id TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS lot5_drive_files (
    version_id TEXT PRIMARY KEY,
    identity TEXT NOT NULL,
    drive_file_id TEXT NOT NULL,
    drive_folder_id TEXT NOT NULL,
    filename TEXT,
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_lot5_drive_files_identity
   ON lot5_drive_files(identity, uploaded_at)`,
];

let ensured = false;

export async function ensureSchema(env) {
  if (ensured) return;
  await env.OPS_DB.batch(STATEMENTS.map((sql) => env.OPS_DB.prepare(sql)));
  ensured = true;
}
