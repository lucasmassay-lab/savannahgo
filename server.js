const express = require('express');
const db = require('./db');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const PI_API_BASE = 'https://api.minepi.com/v2';
const PI_API_KEY = process.env.PI_API_KEY;

// -------- Health check --------
app.get('/api/db-test', async (req, res) => {
  try {
    const result = await db.execute('SELECT 1 as test');
    res.json({ ok: true, test: result.rows[0].test });
  } catch (err) {
    console.error('>>> DB ERROR:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------- Verify user & save to DB --------
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
// -------- List active safaris --------
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
// -------- Approve payment + log to DB --------
app.post('/api/payments/approve', async (req, res) => {
  const { paymentId } = req.body;
  console.log('>>> Received approve request for:', paymentId);
  console.log('>>> API Key (first 10 chars):', PI_API_KEY ? PI_API_KEY.substring(0, 10) : 'MISSING');

  if (!paymentId) {
    console.log('>>> ERROR: No paymentId received!');
    return res.status(400).json({ error: 'paymentId is required' });
  }

  try {
    const approval = await fetch(`${PI_API_BASE}/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Key ${PI_API_KEY}` },
    });

    const body = await approval.text();
    console.log('>>> Pi approve response status:', approval.status);
    console.log('>>> Pi approve response body:', body);

    if (approval.ok) {
      try {
        const parsed = JSON.parse(body || '{}');
        await db.execute({
          sql: `INSERT INTO payments (payment_id, uid, amount, memo, status)
                VALUES (?, ?, ?, ?, 'approved')
                ON CONFLICT(payment_id) DO UPDATE SET
                  status = 'approved',
                  updated_at = CURRENT_TIMESTAMP`,
          args: [
            paymentId,
            parsed.user_uid || null,
            parsed.amount || null,
            parsed.memo || null,
          ],
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

// -------- Complete payment + update DB --------
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
    console.log('>>> Pi complete response body:', body);

    if (completion.ok) {
      try {
        await db.execute({
          sql: `UPDATE payments
                SET status = 'completed',
                    txid = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE payment_id = ?`,
          args: [txid || null, paymentId],
        });
        console.log('>>> Payment marked completed:', paymentId, 'txid:', txid);
      } catch (dbErr) {
        console.error('>>> DB ERROR marking complete:', dbErr.message);
      }
    }

    res.status(completion.status).json(JSON.parse(body || '{}'));
  } catch (err) {
    console.log('>>> FETCH ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});// -------- Record a booking after payment ----------
app.post('/api/bookings', async (req, res) => {
  const { paymentId, safariId } = req.body;
  const accessToken = req.headers.authorization?.replace('Bearer ', '');

  if (!paymentId || !safariId) {
    return res.status(400).json({ error: 'paymentId and safariId required' });
  }

  try {
    // 1. Verify user identity
    const piRes = await fetch(`${PI_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!piRes.ok) return res.status(401).json({ error: 'Unauthorized' });
    const user = await piRes.json();

    // 2. Fetch the safari details
    const safariResult = await db.execute({
      sql: 'SELECT id, name, price_pi FROM safaris WHERE id = ?',
      args: [safariId],
    });
    if (safariResult.rows.length === 0) {
      return res.status(404).json({ error: 'Safari not found' });
    }
    const safari = safariResult.rows[0];

    // 3. Insert the booking (idempotent on payment_id)
    await db.execute({
      sql: `INSERT INTO bookings (payment_id, uid, safari_id, safari_name, price_pi, status)
            VALUES (?, ?, ?, ?, ?, 'completed')
            ON CONFLICT(payment_id) DO UPDATE SET
              status = 'completed'`,
      args: [paymentId, user.uid, safari.id, safari.name, safari.price_pi],
    });

    console.log('>>> Booking recorded:', paymentId, safari.name, `for ${user.username}`);
    res.json({ ok: true, booking: { safari: safari.name, price: safari.price_pi } });
  } catch (err) {
    console.error('>>> DB ERROR recording booking:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------- List bookings for the signed-in user ----------
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
            FROM bookings
            WHERE uid = ?
            ORDER BY created_at DESC`,
      args: [user.uid],
    });

    res.json({ bookings: result.rows });
  } catch (err) {
    console.error('>>> DB ERROR listing bookings:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));