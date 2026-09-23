const express = require('express');
const db = require('./db');
const app = express();
app.use(express.json());
app.use(express.static('public', {
  etag: false,
  maxAge: 0,
  setHeaders: function (res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
}));

const PI_API_BASE = 'https://api.minepi.com/v2';
const PI_API_KEY = process.env.PI_API_KEY;

// -------- Admin auth middleware ----------
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// -------- Health check ----------
app.get('/api/db-test', async (req, res) => {
  try {
    const result = await db.execute('SELECT 1 as test');
    res.json({ ok: true, test: result.rows[0].test });
  } catch (err) {
    console.error('>>> DB ERROR:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------- Verify user & save to DB ----------
app.post('/api/verify', async (req, res) => {
  const accessToken = req.headers.authorization?.replace('Bearer ', '');
  const piRes = await fetch(`${PI_API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!piRes.ok) return res.status(401).json({ error: 'Unauthorized' });

  const user = await piRes.json();

  try {
    await db.execute({
      sql: `INSERT INTO users (uid, username) VALUES (?, ?)
            ON CONFLICT(uid) DO UPDATE SET username = excluded.username`,
      args: [user.uid, user.username],
    });
    console.log('>>> User saved:', user.username, `(${user.uid})`);
  } catch (err) {
    console.error('>>> DB ERROR saving user:', err.message);
  }

  res.json({ uid: user.uid, username: user.username });
});

// -------- List active safaris ----------
app.get('/api/safaris', async (req, res) => {
  try {
    const result = await db.execute(
      'SELECT id, name, location, description, price_pi, duration_days, image_url FROM safaris WHERE active = 1 ORDER BY id'
    );
    res.json({ safaris: result.rows });
  } catch (err) {
    console.error('>>> DB ERROR listing safaris:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Get a single safari with full details + rating ----------
app.get('/api/safaris/:id', async (req, res) => {
  const safariId = parseInt(req.params.id, 10);
  if (isNaN(safariId)) return res.status(400).json({ error: 'Invalid safari id' });

  try {
    const result = await db.execute({
      sql: `SELECT id, name, location, description, price_pi, duration_days,
                   image_url, itinerary, includes, terms
            FROM safaris WHERE id = ? AND active = 1`,
      args: [safariId],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Safari not found' });
    }

    const ratingResult = await db.execute({
      sql: `SELECT COUNT(*) as review_count, ROUND(AVG(rating), 1) as avg_rating
            FROM reviews WHERE safari_id = ?`,
      args: [safariId],
    });
    const rating = ratingResult.rows[0] || { review_count: 0, avg_rating: null };

    res.json({
      safari: result.rows[0],
      rating: { count: rating.review_count, average: rating.avg_rating },
    });
  } catch (err) {
    console.error('>>> DB ERROR loading safari:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Approve payment + log to DB ----------
app.post('/api/payments/approve', async (req, res) => {
  const { paymentId } = req.body;
  console.log('>>> Received approve request for:', paymentId);

  if (!paymentId) return res.status(400).json({ error: 'paymentId is required' });

  try {
    const approval = await fetch(`${PI_API_BASE}/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Key ${PI_API_KEY}` },
    });

    const body = await approval.text();
    console.log('>>> Pi approve response status:', approval.status);

    if (approval.ok) {
      try {
        const parsed = JSON.parse(body || '{}');
        await db.execute({
          sql: `INSERT INTO payments (payment_id, uid, amount, memo, status)
                VALUES (?, ?, ?, ?, 'approved')
                ON CONFLICT(payment_id) DO UPDATE SET
                  status = 'approved', updated_at = CURRENT_TIMESTAMP`,
          args: [paymentId, parsed.user_uid || null, parsed.amount || null, parsed.memo || null],
        });
        console.log('>>> Payment logged (approved):', paymentId);
      } catch (dbErr) {
        console.error('>>> DB ERROR logging approve:', dbErr.message);
      }
    }

    res.status(approval.status).json(JSON.parse(body || '{}'));
  } catch (err) {
    console.log('>>> FETCH ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Complete payment + update DB ----------
app.post('/api/payments/complete', async (req, res) => {
  const { paymentId, txid } = req.body;
  console.log('>>> Received complete request for:', paymentId);

  try {
    const completion = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${PI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ txid }),
    });

    const body = await completion.text();
    console.log('>>> Pi complete response status:', completion.status);

    if (completion.ok) {
      try {
        await db.execute({
          sql: `UPDATE payments SET status = 'completed', txid = ?,
                updated_at = CURRENT_TIMESTAMP WHERE payment_id = ?`,
          args: [txid || null, paymentId],
        });
        console.log('>>> Payment marked completed:', paymentId);
      } catch (dbErr) {
        console.error('>>> DB ERROR marking complete:', dbErr.message);
      }
    }

    res.status(completion.status).json(JSON.parse(body || '{}'));
  } catch (err) {
    console.log('>>> FETCH ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Reviews: list ----------
app.get('/api/safaris/:id/reviews', async (req, res) => {
  const safariId = parseInt(req.params.id, 10);
  if (isNaN(safariId)) return res.status(400).json({ error: 'Invalid safari id' });

  try {
    const result = await db.execute({
      sql: `SELECT id, username, rating, comment, created_at
            FROM reviews WHERE safari_id = ? ORDER BY created_at DESC`,
      args: [safariId],
    });
    res.json({ reviews: result.rows });
  } catch (err) {
    console.error('>>> DB ERROR listing reviews:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Reviews: create/update ----------
app.post('/api/safaris/:id/reviews', async (req, res) => {
  const safariId = parseInt(req.params.id, 10);
  const { rating, comment } = req.body;
  const accessToken = req.headers.authorization?.replace('Bearer ', '');

  if (isNaN(safariId)) return res.status(400).json({ error: 'Invalid safari id' });
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });

  try {
    const piRes = await fetch(`${PI_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!piRes.ok) return res.status(401).json({ error: 'Unauthorized' });
    const user = await piRes.json();

    const bookingCheck = await db.execute({
      sql: 'SELECT 1 FROM bookings WHERE uid = ? AND safari_id = ? LIMIT 1',
      args: [user.uid, safariId],
    });
    if (bookingCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must book this safari before reviewing it' });
    }

    await db.execute({
      sql: `INSERT INTO reviews (uid, username, safari_id, rating, comment)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(uid, safari_id) DO UPDATE SET
              rating = excluded.rating, comment = excluded.comment,
              created_at = CURRENT_TIMESTAMP`,
      args: [user.uid, user.username, safariId, rating, comment || null],
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('>>> DB ERROR saving review:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Record a booking ----------
app.post('/api/bookings', async (req, res) => {
  const { paymentId, safariId } = req.body;
  const accessToken = req.headers.authorization?.replace('Bearer ', '');

  if (!paymentId || !safariId) return res.status(400).json({ error: 'paymentId and safariId required' });

  try {
    const piRes = await fetch(`${PI_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!piRes.ok) return res.status(401).json({ error: 'Unauthorized' });
    const user = await piRes.json();

    const safariResult = await db.execute({
      sql: 'SELECT id, name, price_pi FROM safaris WHERE id = ?',
      args: [safariId],
    });
    if (safariResult.rows.length === 0) return res.status(404).json({ error: 'Safari not found' });
    const safari = safariResult.rows[0];

    await db.execute({
      sql: `INSERT INTO bookings (payment_id, uid, safari_id, safari_name, price_pi, status)
            VALUES (?, ?, ?, ?, ?, 'completed')
            ON CONFLICT(payment_id) DO UPDATE SET status = 'completed'`,
      args: [paymentId, user.uid, safari.id, safari.name, safari.price_pi],
    });

    console.log('>>> Booking recorded:', paymentId, safari.name);
    res.json({ ok: true });
  } catch (err) {
    console.error('>>> DB ERROR recording booking:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- List bookings for user ----------
app.get('/api/bookings', async (req, res) => {
  const accessToken = req.headers.authorization?.replace('Bearer ', '');
  if (!accessToken) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const piRes = await fetch(`${PI_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!piRes.ok) return res.status(401).json({ error: 'Unauthorized' });
    const user = await piRes.json();

    const result = await db.execute({
      sql: `SELECT id, safari_name, price_pi, status, created_at
            FROM bookings WHERE uid = ? ORDER BY created_at DESC`,
      args: [user.uid],
    });

    res.json({ bookings: result.rows });
  } catch (err) {
    console.error('>>> DB ERROR listing bookings:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Get a single booking ----------
app.get('/api/bookings/:id', async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  const accessToken = req.headers.authorization?.replace('Bearer ', '');

  if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking id' });
  if (!accessToken) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const piRes = await fetch(`${PI_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!piRes.ok) return res.status(401).json({ error: 'Unauthorized' });
    const user = await piRes.json();

    const result = await db.execute({
      sql: `SELECT b.id, b.payment_id, b.uid, b.safari_id, b.safari_name,
                   b.price_pi, b.status, b.created_at,
                   s.location, s.duration_days, s.image_url
            FROM bookings b
            LEFT JOIN safaris s ON s.id = b.safari_id
            WHERE b.id = ? AND b.uid = ?`,
      args: [bookingId, user.uid],
    });

    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    const paymentResult = await db.execute({
      sql: 'SELECT txid FROM payments WHERE payment_id = ?',
      args: [result.rows[0].payment_id],
    });

    const booking = result.rows[0];
    booking.txid = paymentResult.rows.length > 0 ? paymentResult.rows[0].txid : null;

    res.json({ booking });
  } catch (err) {
    console.error('>>> DB ERROR loading booking:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Admin: list all safaris ----------
app.get('/api/admin/safaris', requireAdmin, async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM safaris ORDER BY id DESC');
    res.json({ safaris: result.rows });
  } catch (err) {
    console.error('>>> DB ERROR admin list:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Admin: create safari ----------
app.post('/api/admin/safaris', requireAdmin, async (req, res) => {
  const { name, location, description, price_pi, duration_days, image_url, itinerary, includes, terms, active } = req.body;
  if (!name || !price_pi) return res.status(400).json({ error: 'Name and price required' });

  try {
    const result = await db.execute({
      sql: `INSERT INTO safaris
              (name, location, description, price_pi, duration_days,
               image_url, itinerary, includes, terms, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [name, location || null, description || null, price_pi,
        duration_days || 1, image_url || null, itinerary || null,
        includes || null, terms || null, active === 0 ? 0 : 1],
    });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('>>> DB ERROR admin create:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Admin: update safari ----------
app.put('/api/admin/safaris/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const { name, location, description, price_pi, duration_days, image_url, itinerary, includes, terms, active } = req.body;

  try {
    await db.execute({
      sql: `UPDATE safaris SET
              name = ?, location = ?, description = ?, price_pi = ?,
              duration_days = ?, image_url = ?, itinerary = ?,
              includes = ?, terms = ?, active = ? WHERE id = ?`,
      args: [name, location || null, description || null, price_pi,
        duration_days || 1, image_url || null, itinerary || null,
        includes || null, terms || null, active === 0 ? 0 : 1, id],
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('>>> DB ERROR admin update:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Admin: delete safari ----------
app.delete('/api/admin/safaris/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    await db.execute({ sql: 'DELETE FROM safaris WHERE id = ?', args: [id] });
    res.json({ ok: true });
  } catch (err) {
    console.error('>>> DB ERROR admin delete:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Public: submit a contact message ----------
app.post('/api/messages', async (req, res) => {
  const { name, contact, safari_id, safari_name, message } = req.body;
  if (!message || message.trim().length < 3) return res.status(400).json({ error: 'Message is required' });

  try {
    await db.execute({
      sql: `INSERT INTO messages (name, contact, safari_id, safari_name, message)
            VALUES (?, ?, ?, ?, ?)`,
      args: [name || null, contact || null, safari_id || null, safari_name || null, message.trim()],
    });
    console.log('>>> New message from:', name || 'Anonymous');
    res.json({ ok: true });
  } catch (err) {
    console.error('>>> DB ERROR saving message:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Admin: list messages ----------
app.get('/api/admin/messages', requireAdmin, async (req, res) => {
  try {// -------- Admin: list all bookings ----------
app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT b.id, b.payment_id, b.uid, b.safari_id, b.safari_name,
                   b.price_pi, b.status, b.created_at,
                   p.txid,
                   u.username
            FROM bookings b
            LEFT JOIN payments p ON p.payment_id = b.payment_id
            LEFT JOIN users u ON u.uid = b.uid
            ORDER BY b.created_at DESC
            LIMIT 200`,
      args: [],
    });
// -------- Wishlist: add a safari ----------
app.post('/api/wishlist', async (req, res) => {
  const { safariId } = req.body;
  const accessToken = req.headers.authorization?.replace('Bearer ', '');

  if (!safariId) return res.status(400).json({ error: 'safariId required' });
  if (!accessToken) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const piRes = await fetch(`${PI_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!piRes.ok) return res.status(401).json({ error: 'Unauthorized' });
    const user = await piRes.json();

    await db.execute({
      sql: `INSERT INTO wishlist (uid, safari_id) VALUES (?, ?)
            ON CONFLICT(uid, safari_id) DO NOTHING`,
      args: [user.uid, safariId],
    });

    res.json({ ok: true });
        console.log('>>> Wishlist add:', user.username, 'safari', safariId);
  } catch (err) {
    console.error('>>> DB ERROR adding wishlist:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Wishlist: remove a safari ----------
app.delete('/api/wishlist/:safariId', async (req, res) => {
  const safariId = parseInt(req.params.safariId, 10);
  const accessToken = req.headers.authorization?.replace('Bearer ', '');

  if (isNaN(safariId)) return res.status(400).json({ error: 'Invalid safari id' });
  if (!accessToken) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const piRes = await fetch(`${PI_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!piRes.ok) return res.status(401).json({ error: 'Unauthorized' });
    const user = await piRes.json();

    await db.execute({
      sql: 'DELETE FROM wishlist WHERE uid = ? AND safari_id = ?',
      args: [user.uid, safariId],
    });

    res.json({ ok: true });
        console.log('>>> Wishlist remove:', user.username, 'safari', safariId);
  } catch (err) {
    console.error('>>> DB ERROR removing wishlist:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Wishlist: list user's favorites ----------
app.get('/api/wishlist', async (req, res) => {
  const accessToken = req.headers.authorization?.replace('Bearer ', '');
  if (!accessToken) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const piRes = await fetch(`${PI_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!piRes.ok) return res.status(401).json({ error: 'Unauthorized' });
    const user = await piRes.json();

    const result = await db.execute({
      sql: `SELECT w.id, w.safari_id, w.created_at,
                   s.name, s.location, s.price_pi, s.duration_days, s.image_url
            FROM wishlist w
            JOIN safaris s ON s.id = w.safari_id
            WHERE w.uid = ?
            ORDER BY w.created_at DESC`,
      args: [user.uid],
    });

    res.json({ wishlist: result.rows });
  } catch (err) {
    console.error('>>> DB ERROR listing wishlist:', err.message);
    res.status(500).json({ error: err.message });
  }
});

    // Summary stats
    const summary = await db.execute(`
      SELECT COUNT(*) as total_count,
             COALESCE(SUM(price_pi), 0) as total_pi
      FROM bookings
    `);

    res.json({
      bookings: result.rows,
      summary: summary.rows[0] || { total_count: 0, total_pi: 0 },
    });
  } catch (err) {
    console.error('>>> DB ERROR admin bookings:', err.message);
    res.status(500).json({ error: err.message });
  }
});
    const result = await db.execute('SELECT * FROM messages ORDER BY created_at DESC');
    res.json({ messages: result.rows });
  } catch (err) {
    console.error('>>> DB ERROR admin messages:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Admin: update message status ----------
app.put('/api/admin/messages/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!status) return res.status(400).json({ error: 'Status required' });

  try {
    await db.execute({ sql: 'UPDATE messages SET status = ? WHERE id = ?', args: [status, id] });
    res.json({ ok: true });
  } catch (err) {
    console.error('>>> DB ERROR updating message:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Admin: delete message ----------
app.delete('/api/admin/messages/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    await db.execute({ sql: 'DELETE FROM messages WHERE id = ?', args: [id] });
    res.json({ ok: true });
  } catch (err) {
    console.error('>>> DB ERROR deleting message:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- Fallback: serve index.html for non-API routes ----------
app.get('/{*splat}', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(__dirname + '/public/index.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));