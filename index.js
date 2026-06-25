import express from 'express';
import pg from 'pg';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Pool } = pg;

const app = express();
const PORT = process.env.PORT || 3001;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

app.use(cors());
app.use(express.json());

// --- Image Upload ---
const imagesDir = path.join(__dirname, '../app/public/images');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, imagesDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, '-').toLowerCase();
    cb(null, `${name}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif|jpg)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const url = `/images/${req.file.filename}`;
  return res.json({ url });
});

// --- Registrations ---
app.post('/api/register', async (req, res) => {
  const { name, email, whatsapp } = req.body;
  if (!name || !email || !whatsapp) return res.status(400).json({ error: 'All fields are required.' });
  try {
    const result = await pool.query(
      'INSERT INTO registrations (name, email, whatsapp) VALUES ($1, $2, $3) RETURNING id, created_at',
      [name.trim(), email.trim(), whatsapp.trim()]
    );
    return res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Registration error:', err.message);
    return res.status(500).json({ error: 'Failed to save registration.' });
  }
});

app.get('/api/registrations', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, whatsapp, created_at FROM registrations ORDER BY created_at DESC'
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch registrations.' });
  }
});

// --- Site Content ---
app.get('/api/content', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM site_content');
    const content = {};
    for (const row of result.rows) content[row.key] = row.value;
    return res.json(content);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch content.' });
  }
});

app.post('/api/content', async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'Invalid payload.' });
  try {
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO site_content (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, String(value)]
      );
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update content.' });
  }
});

// --- Testimonials ---
app.get('/api/testimonials', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM testimonials WHERE active = true ORDER BY sort_order ASC, id ASC');
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch testimonials.' });
  }
});

app.get('/api/testimonials/all', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM testimonials ORDER BY sort_order ASC, id ASC');
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch testimonials.' });
  }
});

app.post('/api/testimonials', async (req, res) => {
  const { name, role, problem, type, content, image_url, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  try {
    const result = await pool.query(
      `INSERT INTO testimonials (name, role, problem, type, content, image_url, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, role || '', problem || '', type || 'text', content || '', image_url || '', sort_order || 0]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create testimonial.' });
  }
});

app.put('/api/testimonials/:id', async (req, res) => {
  const { id } = req.params;
  const { name, role, problem, type, content, image_url, sort_order, active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE testimonials SET name=COALESCE($1,name), role=COALESCE($2,role), problem=COALESCE($3,problem),
       type=COALESCE($4,type), content=COALESCE($5,content), image_url=COALESCE($6,image_url),
       sort_order=COALESCE($7,sort_order), active=COALESCE($8,active) WHERE id=$9 RETURNING *`,
      [name, role, problem, type, content, image_url, sort_order, active, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update testimonial.' });
  }
});

app.delete('/api/testimonials/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM testimonials WHERE id=$1', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete testimonial.' });
  }
});

// --- FAQs ---
app.get('/api/faqs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM faqs ORDER BY sort_order ASC, id ASC');
    return res.json(result.rows);
  } catch (err) {
    return res.json([]);
  }
});

app.post('/api/faqs', async (req, res) => {
  const { question, answer, sort_order } = req.body;
  if (!question || !answer) return res.status(400).json({ error: 'Question and answer required.' });
  try {
    const result = await pool.query(
      'INSERT INTO faqs (question, answer, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [question, answer, sort_order || 0]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create FAQ.' });
  }
});

app.put('/api/faqs/:id', async (req, res) => {
  const { question, answer, sort_order } = req.body;
  try {
    const result = await pool.query(
      `UPDATE faqs SET question=COALESCE($1,question), answer=COALESCE($2,answer), sort_order=COALESCE($3,sort_order) WHERE id=$4 RETURNING *`,
      [question, answer, sort_order, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update FAQ.' });
  }
});

app.delete('/api/faqs/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM faqs WHERE id=$1', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete FAQ.' });
  }
});

// --- Notifications (Social Proof Popups) ---
app.get('/api/notifications', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notifications WHERE active=true ORDER BY sort_order ASC, id ASC');
    return res.json(result.rows);
  } catch (err) {
    return res.json([]);
  }
});

app.get('/api/notifications/all', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notifications ORDER BY sort_order ASC, id ASC');
    return res.json(result.rows);
  } catch (err) {
    return res.json([]);
  }
});

app.post('/api/notifications', async (req, res) => {
  const { name, location, message, time_ago, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  try {
    const result = await pool.query(
      'INSERT INTO notifications (name, location, message, time_ago, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, location || '', message || 'Registered to Healing Workshop', time_ago || 'just now', sort_order || 0]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create notification.' });
  }
});

app.put('/api/notifications/:id', async (req, res) => {
  const { name, location, message, time_ago, sort_order, active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE notifications SET name=COALESCE($1,name), location=COALESCE($2,location), message=COALESCE($3,message),
       time_ago=COALESCE($4,time_ago), sort_order=COALESCE($5,sort_order), active=COALESCE($6,active) WHERE id=$7 RETURNING *`,
      [name, location, message, time_ago, sort_order, active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update notification.' });
  }
});

app.delete('/api/notifications/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM notifications WHERE id=$1', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete notification.' });
  }
});

// --- Seed defaults (runs once when tables are empty) ---
(async () => {
  try {
    const notifCount = await pool.query('SELECT COUNT(*) FROM notifications');
    if (parseInt(notifCount.rows[0].count) === 0) {
      const defaultNotifs = [
        { name: 'Ashish Gupta', location: 'Maharashtra', message: 'Registered to Healing Workshop', time_ago: '1 year ago', sort_order: 1 },
        { name: 'Priya Sharma', location: 'Delhi', message: 'Booked a Free Healing Session', time_ago: '2 days ago', sort_order: 2 },
        { name: 'Ravi Kumar', location: 'Bangalore', message: 'Joined the Healing Community', time_ago: '3 hours ago', sort_order: 3 },
        { name: 'Sunita Patel', location: 'Gujarat', message: 'Registered to Healing Workshop', time_ago: '5 minutes ago', sort_order: 4 },
        { name: 'Deepa Nair', location: 'Kerala', message: 'Booked a Free Healing Session', time_ago: '1 day ago', sort_order: 5 },
      ];
      for (const n of defaultNotifs) {
        await pool.query(
          'INSERT INTO notifications (name, location, message, time_ago, sort_order) VALUES ($1,$2,$3,$4,$5)',
          [n.name, n.location, n.message, n.time_ago, n.sort_order]
        );
      }
      console.log('Seeded default notifications.');
    }
  } catch (err) {
    console.error('Notification seed error:', err.message);
  }

  try {
    const testimonialsCount = await pool.query('SELECT COUNT(*) FROM testimonials');
    if (parseInt(testimonialsCount.rows[0].count) === 0) {
      const defaultTestimonials = [
        { name: 'Meena Sharma', role: 'Homemaker', problem: 'Chronic back pain for 5 years', type: 'text', content: 'I had been suffering from chronic back pain for over 5 years and had tried every medicine. After just 2 healing sessions with Ankit sir, my pain reduced by 80%. It felt like a miracle. I am forever grateful!', sort_order: 1 },
        { name: 'Rajesh Verma', role: 'Software Engineer', problem: 'Anxiety and stress', type: 'text', content: 'I was struggling with severe anxiety and could not sleep at night. The energy healing sessions helped me release all the negative energy. Now I sleep peacefully and feel calm throughout the day. Highly recommended!', sort_order: 2 },
        { name: 'Anita Joshi', role: 'Teacher', problem: 'Migraine and headaches', type: 'text', content: 'I used to get migraines 3-4 times a week and medicines were not helping. After the healing sessions, my migraines have almost disappeared. I feel energetic and positive every day. Thank you Ankit sir!', sort_order: 3 },
        { name: 'Suresh Kumar', role: 'Businessman', problem: 'Diabetes and fatigue', type: 'text', content: 'My sugar levels were out of control and I felt tired all the time. After energy healing sessions, my sugar levels normalized and I have so much more energy now. This is truly divine healing!', sort_order: 4 },
      ];
      for (const t of defaultTestimonials) {
        await pool.query(
          `INSERT INTO testimonials (name, role, problem, type, content, image_url, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [t.name, t.role, t.problem, t.type, t.content, '', t.sort_order]
        );
      }
      console.log('Seeded default testimonials.');
    }
  } catch (err) {
    console.error('Testimonials seed error:', err.message);
  }

  try {
    const faqCount = await pool.query('SELECT COUNT(*) FROM faqs');
    if (parseInt(faqCount.rows[0].count) === 0) {
      const defaultFAQs = [
        { question: 'What is Energy Healing and how does it work?', answer: 'Energy healing is a holistic practice that works with the body\'s natural energy systems to remove blockages, restore balance, and promote physical, emotional, and spiritual well-being. It works by channeling positive healing energy to the affected areas, clearing negative energy and allowing your body to heal itself naturally — without any medicines or physical contact required.', sort_order: 1 },
        { question: 'Is this session completely FREE? Are there any hidden charges?', answer: 'Yes, the introductory 1-on-1 healing session is completely FREE — no hidden charges whatsoever. The session normally costs ₹999, but we offer it free so you can experience the results yourself before making any commitment. You only pay if you choose to continue with further sessions.', sort_order: 2 },
        { question: 'I am not in India. Can I attend the session from outside India?', answer: 'Absolutely! Energy healing works across any distance. We conduct sessions online via WhatsApp or Zoom video call, so you can join from anywhere in the world — whether you are in India, the USA, UK, UAE, or any other country. All you need is a stable internet connection.', sort_order: 3 },
        { question: 'What types of health problems can be treated with Energy Healing?', answer: 'Energy healing can help with a wide range of physical, emotional, and mental health issues including: chronic pain (back pain, joint pain, migraines), anxiety, stress and depression, diabetes, thyroid disorders, blood pressure, skin problems, digestive issues, sleep disorders, and emotional trauma. However, it is complementary — not a replacement for emergency medical treatment.', sort_order: 4 },
        { question: 'How long does one healing session last?', answer: 'Each 1-on-1 session typically lasts 30 to 45 minutes. During the session, Ankit will first understand your health concerns, then perform energy healing, and explain what was found and cleared. You may feel relaxation, warmth, tingling, or emotional release during the session — this is completely normal and indicates the healing is working.', sort_order: 5 },
        { question: 'Do I need any special preparation before the session?', answer: 'No special preparation is needed. Just sit or lie down comfortably in a quiet place, wear loose and comfortable clothing, keep your phone charged and internet connection stable, and come with an open mind. Avoid eating a heavy meal 1 hour before the session. That is all!', sort_order: 6 },
        { question: 'How many sessions will I need to see results?', answer: 'Many people notice positive changes after the very first session — improved sleep, reduced pain, or a feeling of calm and lightness. However, chronic or long-standing conditions typically require 3 to 7 sessions for significant and lasting results. Ankit will assess your situation during the free session and recommend a personalised healing plan.', sort_order: 7 },
        { question: 'Is Energy Healing safe? Are there any side effects?', answer: 'Yes, energy healing is completely safe, non-invasive, and has no negative side effects. It works with your body\'s own natural healing intelligence. Some people may feel mild tiredness or emotional release after the first session — this is a normal part of the healing process and passes within 24 hours. It is safe for all ages including children and the elderly.', sort_order: 8 },
      ];
      for (const f of defaultFAQs) {
        await pool.query(
          'INSERT INTO faqs (question, answer, sort_order) VALUES ($1,$2,$3)',
          [f.question, f.answer, f.sort_order]
        );
      }
      console.log('Seeded default FAQs.');
    }
  } catch (err) {
    console.error('FAQ seed error:', err.message);
  }
})();

// --- A/B Tests ---
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ab_tests (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      label VARCHAR(255) DEFAULT '',
      variant_a_text TEXT NOT NULL DEFAULT '',
      variant_b_text TEXT NOT NULL DEFAULT '',
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ab_events (
      id SERIAL PRIMARY KEY,
      test_id INTEGER REFERENCES ab_tests(id) ON DELETE CASCADE,
      variant CHAR(1) NOT NULL,
      event_type VARCHAR(50) NOT NULL,
      session_id VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
})().catch(err => console.error('AB tables init:', err.message));

app.get('/api/ab-tests', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*,
        COUNT(CASE WHEN e.variant='a' AND e.event_type='impression' THEN 1 END) AS impressions_a,
        COUNT(CASE WHEN e.variant='b' AND e.event_type='impression' THEN 1 END) AS impressions_b,
        COUNT(CASE WHEN e.variant='a' AND e.event_type='conversion' THEN 1 END) AS conversions_a,
        COUNT(CASE WHEN e.variant='b' AND e.event_type='conversion' THEN 1 END) AS conversions_b
      FROM ab_tests t
      LEFT JOIN ab_events e ON e.test_id = t.id
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `);
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch tests.' });
  }
});

app.post('/api/ab-tests', async (req, res) => {
  const { name, label, variant_a_text, variant_b_text } = req.body;
  if (!name || !variant_a_text || !variant_b_text) return res.status(400).json({ error: 'name, variant_a_text, and variant_b_text are required.' });
  try {
    const result = await pool.query(
      'INSERT INTO ab_tests (name, label, variant_a_text, variant_b_text) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, label || '', variant_a_text, variant_b_text]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create test.' });
  }
});

app.put('/api/ab-tests/:id', async (req, res) => {
  const { name, label, variant_a_text, variant_b_text, active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE ab_tests SET
        name=COALESCE($1,name), label=COALESCE($2,label),
        variant_a_text=COALESCE($3,variant_a_text), variant_b_text=COALESCE($4,variant_b_text),
        active=COALESCE($5,active)
       WHERE id=$6 RETURNING *`,
      [name, label, variant_a_text, variant_b_text, active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update test.' });
  }
});

app.delete('/api/ab-tests/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM ab_tests WHERE id=$1', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete test.' });
  }
});

app.post('/api/ab-events', async (req, res) => {
  const { test_id, variant, event_type, session_id } = req.body;
  if (!test_id || !variant || !event_type) return res.status(400).json({ error: 'test_id, variant, and event_type required.' });
  try {
    await pool.query(
      'INSERT INTO ab_events (test_id, variant, event_type, session_id) VALUES ($1,$2,$3,$4)',
      [test_id, variant, event_type, session_id || null]
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to record event.' });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// --- Stats / Dashboard ---
app.get('/api/stats', async (_req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) FROM registrations');
    const today = await pool.query("SELECT COUNT(*) FROM registrations WHERE created_at >= CURRENT_DATE");
    const week = await pool.query("SELECT COUNT(*) FROM registrations WHERE created_at >= date_trunc('week', NOW())");
    const month = await pool.query("SELECT COUNT(*) FROM registrations WHERE created_at >= date_trunc('month', NOW())");
    const daily = await pool.query(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM registrations
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at) ORDER BY date ASC
    `);
    const byStage = await pool.query(`
      SELECT COALESCE(crm_stage,'new') as crm_stage, COUNT(*) as count
      FROM registrations GROUP BY crm_stage
    `);
    return res.json({
      total: parseInt(total.rows[0].count),
      today: parseInt(today.rows[0].count),
      week: parseInt(week.rows[0].count),
      month: parseInt(month.rows[0].count),
      daily: daily.rows,
      byStage: byStage.rows,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// --- CRM stage/notes/tags update ---
app.put('/api/registrations/:id/crm', async (req, res) => {
  const { crm_stage, notes, tags } = req.body;
  try {
    const result = await pool.query(
      'UPDATE registrations SET crm_stage=COALESCE($1,crm_stage), notes=COALESCE($2,notes), tags=COALESCE($3,tags) WHERE id=$4 RETURNING *',
      [crm_stage, notes, tags, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// --- Media listing & delete ---
app.get('/api/media', (_req, res) => {
  try {
    if (!fs.existsSync(imagesDir)) return res.json([]);
    const files = fs.readdirSync(imagesDir)
      .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(imagesDir, f));
        return { filename: f, url: `/images/${f}`, size: stat.size, created: stat.birthtime };
      });
    return res.json(files);
  } catch (err) {
    return res.json([]);
  }
});

app.delete('/api/media/:filename', (req, res) => {
  try {
    const filePath = path.join(imagesDir, req.params.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// --- Automations CRUD ---
app.get('/api/automations', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM automations ORDER BY created_at DESC');
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/automations', async (req, res) => {
  const { name, trigger_type, action_type, action_config } = req.body;
  if (!name || !action_type) return res.status(400).json({ error: 'name and action_type required' });
  try {
    const result = await pool.query(
      'INSERT INTO automations (name, trigger_type, action_type, action_config) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, trigger_type || 'on_registration', action_type, JSON.stringify(action_config || {})]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/automations/:id', async (req, res) => {
  const { name, trigger_type, action_type, action_config, active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE automations SET name=COALESCE($1,name), trigger_type=COALESCE($2,trigger_type),
       action_type=COALESCE($3,action_type), action_config=COALESCE($4::jsonb,action_config),
       active=COALESCE($5,active) WHERE id=$6 RETURNING *`,
      [name, trigger_type, action_type, action_config ? JSON.stringify(action_config) : null, active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/automations/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM automations WHERE id=$1', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
