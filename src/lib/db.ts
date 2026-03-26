import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "database.sqlite"));

// Enable Foreign Keys
db.pragma('foreign_keys = ON');

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('parent', 'teacher', 'child', 'family'))
  );

  CREATE TABLE IF NOT EXISTS family_links (
    parent_id TEXT REFERENCES users(id),
    child_id TEXT REFERENCES users(id),
    PRIMARY KEY (parent_id, child_id)
  );

  CREATE TABLE IF NOT EXISTS educational_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id TEXT REFERENCES users(id),
    teacher_id TEXT REFERENCES users(id),
    type TEXT NOT NULL, -- 'attendance', 'grade', 'behavior'
    status TEXT NOT NULL,
    category TEXT NOT NULL, -- 'School', 'Sports', 'Quran'
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS locations (
    child_id TEXT REFERENCES users(id),
    latitude REAL,
    longitude REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    type TEXT NOT NULL, -- 'school_event', 'sports_match', 'summons'
    created_by TEXT REFERENCES users(id),
    target_role TEXT -- 'parent', 'teacher', 'all'
  );
`);

// Seed Mock Data for Prototype
const seedMockData = () => {
  const checkUser = db.prepare("SELECT id FROM users WHERE id = ?");
  const insertUser = db.prepare("INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)");

  if (!checkUser.get('child_123')) {
    insertUser.run('child_123', 'Ahmed', 'ahmed@example.com', 'mock_pass', 'child');
  }
  if (!checkUser.get('parent_456')) {
    insertUser.run('parent_456', 'Ahmed Father', 'father@example.com', 'mock_pass', 'parent');
  }
};

seedMockData();

export default db;
