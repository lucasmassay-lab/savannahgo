Pi.init({ version: "2.0", sandbox: true });

let accessToken = null;

document.getElementById('login').onclick = async () => {
  try {
    const auth = await window.Pi.authenticate(
      ['username', 'payments'],
      onIncompletePayment
    );
    accessToken = auth.accessToken;
    await verifyOnServer(accessToken);
    document.getElementById('status').innerText = `Hello, ${auth.user.username}`;
    document.getElementById('pay').disabled = false;
  } catch (err) {
    console.error('Auth failed', err);
  }
};

async function verifyOnServer(token) {
  const res = await fetch('/api/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Server could not verify this user');
  return res.json();
}

function onIncompletePayment(payment) {
  return fetch('/api/payments/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentId: payment.identifier,
      txid: payment.transaction?.txid,
    }),
  });
}

document.getElementById('pay').onclick = () => {
  window.Pi.createPayment(
    { amount: 1, memo: 'Unlock Premium', metadata: { feature: 'premium' } },
    {
      onReadyForServerApproval: async (paymentId) => {
        await fetch('/api/payments/approve', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ paymentId }),
        });
      },
      onReadyForServerCompletion: async (paymentId, txid) => {
        const res = await fetch('/api/payments/complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ paymentId, txid }),
        });
        if (res.ok) {
          document.getElementById('status').innerText = 'Payment complete';
        }
      },
      onCancel: (paymentId) => console.log('Cancelled:', paymentId),
      onError: (error, payment) => console.error('Payment error:', error, payment),
    }
  );
};