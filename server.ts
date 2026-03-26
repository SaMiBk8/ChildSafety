import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import db from "./src/lib/db";

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-for-grad-project";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // --- Auth Middleware ---
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  // --- API Routes ---
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Child Safety System Backend Active" });
  });

  // Register
  app.post("/api/auth/register", async (req, res) => {
    const { name, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();

    try {
      const stmt = db.prepare("INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)");
      stmt.run(id, name, email, hashedPassword, role);
      res.status(201).json({ message: "User created", userId: id });
    } catch (error) {
      res.status(400).json({ error: "Email already exists" });
    }
  });

  // Login
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const user: any = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  });

  // Get Educational Logs
  app.get("/api/logs/:childId", authenticateToken, (req, res) => {
    const logs = db.prepare("SELECT * FROM educational_logs WHERE child_id = ? ORDER BY timestamp DESC").all(req.params.childId);
    res.json(logs);
  });

  // Create Educational Log
  app.post("/api/logs", authenticateToken, (req: any, res) => {
    if (req.user.role !== 'teacher') return res.status(403).json({ error: "Only teachers can add logs" });
    
    const { childId, type, status, category } = req.body;
    const stmt = db.prepare("INSERT INTO educational_logs (child_id, teacher_id, type, status, category) VALUES (?, ?, ?, ?, ?)");
    stmt.run(childId, req.user.id, type, status, category);
    res.status(201).json({ message: "Log created" });
  });

  // --- Calendar Routes ---
  app.get("/api/calendar", authenticateToken, (req: any, res) => {
    const role = req.user.role;
    let events;
    if (role === 'child') {
      events = db.prepare("SELECT * FROM calendar_events WHERE target_role IN ('all', 'child') ORDER BY start_time ASC").all();
    } else if (role === 'teacher') {
      events = db.prepare("SELECT * FROM calendar_events WHERE target_role IN ('all', 'teacher') ORDER BY start_time ASC").all();
    } else {
      events = db.prepare("SELECT * FROM calendar_events ORDER BY start_time ASC").all();
    }
    res.json(events);
  });

  app.post("/api/calendar", authenticateToken, (req: any, res) => {
    if (req.user.role === 'child') return res.status(403).json({ error: "Children cannot create events" });
    
    const { title, description, start_time, end_time, type, target_role } = req.body;
    const stmt = db.prepare("INSERT INTO calendar_events (title, description, start_time, end_time, type, created_by, target_role) VALUES (?, ?, ?, ?, ?, ?, ?)");
    stmt.run(title, description, start_time, end_time, type, req.user.id, target_role || 'all');
    res.status(201).json({ message: "Event created" });
  });

  // --- Family Management ---
  app.get("/api/family/children", authenticateToken, (req: any, res) => {
    if (req.user.role !== 'parent' && req.user.role !== 'family') return res.status(403).json({ error: "Unauthorized" });
    const children = db.prepare(`
      SELECT u.id, u.name, u.email 
      FROM users u 
      JOIN family_links fl ON u.id = fl.child_id 
      WHERE fl.parent_id = ?
    `).all(req.user.id);
    res.json(children);
  });

  app.post("/api/family/link", authenticateToken, (req: any, res) => {
    if (req.user.role !== 'parent') return res.status(403).json({ error: "Only parents can link children" });
    const { childEmail } = req.body;
    const child: any = db.prepare("SELECT id FROM users WHERE email = ? AND role = 'child'").get(childEmail);
    if (!child) return res.status(404).json({ error: "Child not found" });

    try {
      db.prepare("INSERT INTO family_links (parent_id, child_id) VALUES (?, ?)").run(req.user.id, child.id);
      res.json({ message: "Child linked successfully" });
    } catch (e) {
      res.status(400).json({ error: "Already linked" });
    }
  });

  // --- Educational Analytics ---
  app.get("/api/analytics/:childId", authenticateToken, (req, res) => {
    const stats = db.prepare(`
      SELECT type, COUNT(*) as count 
      FROM educational_logs 
      WHERE child_id = ? 
      GROUP BY type
    `).all(req.params.childId);
    
    const grades = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM educational_logs 
      WHERE child_id = ? AND type = 'grade'
      GROUP BY status
    `).all(req.params.childId);

    res.json({ stats, grades });
  });

  // --- Location History ---
  app.get("/api/locations/:childId", authenticateToken, (req, res) => {
    const history = db.prepare("SELECT * FROM locations WHERE child_id = ? ORDER BY timestamp DESC LIMIT 50").all(req.params.childId);
    res.json(history);
  });

  // --- Real-time Socket Logic ---
  io.on("connection", (socket) => {
    socket.on("update_location", (data) => {
      io.emit(`location_${data.childId}`, data);
      // Optional: Persist to DB for history
      db.prepare("INSERT INTO locations (child_id, latitude, longitude) VALUES (?, ?, ?)").run(data.childId, data.lat, data.lng);
    });

    socket.on("trigger_sos", (data) => {
      io.emit(`sos_alert_${data.parentId}`, {
        childId: data.childId,
        timestamp: new Date(),
        message: "EMERGENCY: SOS Button Pressed!"
      });
    });

    socket.on("webrtc_signal", (data) => {
      // Relay signaling data (offer, answer, candidates) to the target user
      io.emit(`webrtc_signal_${data.targetId}`, {
        signal: data.signal,
        senderId: data.senderId
      });
    });
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
