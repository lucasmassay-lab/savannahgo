Pi.init({ version: "2.0", sandbox: false });

let accessToken = null;
let currentUser = null;
let safaris = [];

// ---------- Modal ----------
function showModal(message) {
  document.getElementById('modalMessage').innerHTML = message;
  document.getElementById('successModal').classList.add('show');
}

function closeModal() {
  document.getElementById('successModal').classList.remove('show');
}

// ---------- Status helper ----------
function showStatus(message, type = 'info') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = 'show ' + type;
  setTimeout(() => { el.className = ''; }, 5000);
}

// ---------- Load safaris ----------
async function loadSafaris() {
  try {
    const res = await fetch('/api/safaris');
    const data = await res.json();
    safaris = data.safaris || [];
    renderSafaris();
  } catch (err) {
    console.error('Failed to load safaris', err);
    document.getElementById('safariGrid').innerHTML =
      '<p>Could not load safaris. Please refresh.</p>';
  }
}

function renderSafaris() {
  const grid = document.getElementById('safariGrid');
  if (safaris.length === 0) {
    grid.innerHTML = '<div class="empty-state">No safaris available right now.</div>';
    return;
  }
    grid.innerHTML = safaris.map(s => `
    <a href="/safari/${s.id}" class="safari-card">
      <img src="${s.image_url}" alt="${s.name}" loading="lazy" />
      <div class="safari-body">
        <h3>${s.name}</h3>
        <div class="safari-loc">📍 ${s.location}</div>
        <div class="safari-desc">${s.description}</div>
        <div class="safari-meta">
          <div class="safari-price">
            ${s.price_pi} π <small>${s.duration_days} day${s.duration_days > 1 ? 's' : ''}</small>
          </div>
          <span class="view-btn">View →</span>
        </div>
      </div>
    </a>
  `).join('');
}

// ---------- Auth ----------
document.getElementById('login').onclick = async () => {
  try {
    const auth = await window.Pi.authenticate(
      ['username', 'payments'],
      onIncompletePayment
    );
    accessToken = auth.accessToken;
    currentUser = auth.user;
    await verifyOnServer(accessToken);

    const initial = (currentUser.username || '?').charAt(0).toUpperCase();
    document.getElementById('userInfo').innerHTML = `
      <div class="avatar">${initial}</div>
      <span class="user-name">${currentUser.username}</span>
    `;
    document.getElementById('login').style.display = 'none';

    renderSafaris();
    loadBookings();
    showStatus(`Welcome, ${currentUser.username}!`, 'success');
  } catch (err) {
    console.error('Auth failed', err);
    showStatus('Sign-in failed. Please try again.', 'error');
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

// ---------- Booking (payment) ----------
function bookSafari(safariId) {
  const safari = safaris.find(s => s.id === safariId);
  if (!safari) return;

  showStatus(`Preparing payment for ${safari.name}...`, 'info');

  window.Pi.createPayment(
    {
      amount: safari.price_pi,
      memo: `Booking: ${safari.name}`,
      metadata: { safari_id: safari.id, safari_name: safari.name },
    },
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
          await fetch('/api/bookings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              paymentId,
              safariId: safari.id,
            }),
          });

          showStatus(`✅ Booking confirmed: ${safari.name}`, 'success');
          showModal(`<strong>${safari.name}</strong><br>${safari.price_pi} π paid successfully`);
          loadBookings();
        }
      },
      onCancel: (paymentId) => {
        console.log('Cancelled:', paymentId);
        showStatus('Payment cancelled.', 'info');
      },
      onError: (error, payment) => {
        console.error('Payment error:', error, payment);
        showStatus('Payment failed. Please try again.', 'error');
      },
    }
  );
}

// ---------- Load bookings ----------
async function loadBookings() {
  if (!accessToken) return;
  try {
    const res = await fetch('/api/bookings', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    renderBookings(data.bookings || []);
  } catch (err) {
    console.error('Failed to load bookings', err);
  }
}

function renderBookings(bookings) {
  const section = document.getElementById('bookingsSection');
  const list = document.getElementById('bookingsList');

  if (bookings.length === 0) {
    section.style.display = 'block';
    list.innerHTML = '<div class="empty-state">No bookings yet. Book a safari above!</div>';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = bookings.map(b => `
    <div class="booking-row">
      <div class="booking-info">
        <strong>${b.safari_name}</strong>
        <small>${b.price_pi} π • ${new Date(b.created_at).toLocaleDateString()}</small>
      </div>
      <span class="booking-status status-${b.status}">${b.status}</span>
    </div>
  `).join('');
}

// ---------- Router ----------
function route() {
  const path = window.location.pathname;

  if (path === '/' || path === '/index.html') {
    renderListingsPage();
  } else if (path.startsWith('/safari/')) {
    const id = path.split('/')[2];
    renderDetailPage(id);
  } else {
    renderListingsPage();
  }
}

async function renderListingsPage() {
  // Restore listings layout
  document.getElementById('mainContent').innerHTML = `
    <section>
      <h2>🦁 Available Safaris</h2>
      <div id="safariGrid" class="safari-grid">
        <div class="skeleton"></div>
        <div class="skeleton"></div>
        <div class="skeleton"></div>
      </div>
    </section>
    <section class="bookings-section" id="bookingsSection" style="display:none;">
      <h2>🎫 My Bookings</h2>
      <div id="bookingsList"></div>
    </section>
  `;

  await loadSafaris();

  if (accessToken) {
    loadBookings();
  }
}

async function renderDetailPage(id) {
  const container = document.getElementById('mainContent');
  container.innerHTML = '<div class="skeleton" style="height:400px;"></div>';

  try {
    const res = await fetch(`/api/safaris/${id}`);
    if (!res.ok) {
      container.innerHTML = '<div class="empty-state">Safari not found.</div>';
      return;
    }
    const { safari } = await res.json();
    renderSafariDetail(safari);
  } catch (err) {
    console.error('Failed to load safari', err);
    container.innerHTML = '<div class="empty-state">Could not load safari.</div>';
  }
}

function renderSafariDetail(s) {
  const container = document.getElementById('mainContent');
  container.innerHTML = `
    <a href="/" class="back-link" onclick="event.preventDefault(); navigate('/')">← Back to safaris</a>

    <div class="detail-hero">
      <img src="${s.image_url}" alt="${s.name}" />
      <div class="detail-overlay">
        <h1>${s.name}</h1>
        <div class="detail-loc">📍 ${s.location}</div>
      </div>
    </div>

    <div class="detail-body">
      <div class="detail-meta">
        <div class="detail-price">${s.price_pi} π</div>
        <div class="detail-duration">${s.duration_days} day${s.duration_days > 1 ? 's' : ''}</div>
      </div>

      <h2>About this safari</h2>
      <p>${s.description}</p>

      ${s.itinerary ? `<h2>Itinerary</h2><p>${s.itinerary}</p>` : ''}
      ${s.includes ? `<h2>What's included</h2><p>${s.includes}</p>` : ''}
      ${s.terms ? `<h2>Terms & conditions</h2><p>${s.terms}</p>` : ''}

      <button class="book-btn-large" onclick="bookSafari(${s.id})" ${accessToken ? '' : 'disabled'}>
        ${accessToken ? `Book for ${s.price_pi} π` : 'Sign in to book'}
      </button>
    </div>
  `;
}

// Simple navigation helper
function navigate(url) {
  history.pushState({}, '', url);
  route();
}

// Handle browser back/forward
window.addEventListener('popstate', route);

// Intercept clicks on cards for smooth navigation
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="/"]');
  if (link && !link.hasAttribute('onclick')) {
    e.preventDefault();
    navigate(link.getAttribute('href'));
  }
});

// ---------- Init ----------
route();