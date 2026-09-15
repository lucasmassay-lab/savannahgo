const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const PI_API_BASE = 'https://api.minepi.com/v2';
const PI_API_KEY = process.env.PI_API_KEY;

app.post('/api/verify', async (req, res) => {
  const accessToken = req.headers.authorization?.replace('Bearer ', '');
  const piRes = await fetch(`${PI_API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!piRes.ok) return res.status(401).json({ error: 'Unauthorized' });
  const user = await piRes.json();
  res.json({ uid: user.uid, username: user.username });
});

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

    res.status(approval.status).json(JSON.parse(body || '{}'));
  } catch (err) {
    console.log('>>> FETCH ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

    res.status(completion.status).json(JSON.parse(body || '{}'));
  } catch (err) {
    console.log('>>> FETCH ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));