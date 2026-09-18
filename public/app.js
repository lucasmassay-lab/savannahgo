Pi.init({ version: "2.0", sandbox: true });

let accessToken = null;
let currentUser = null;
let safaris = [];
let allSafaris = [];
let filteredSafaris = [];

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
    allSafaris = safaris;
    filteredSafaris = safaris;
    renderFilteredSafaris();
  } catch (err) {
    console.error('Failed to load safaris', err);
    const grid = document.getElementById('safariGrid');
    if (grid) {
      grid.innerHTML = '<div class="empty-state">Could not load safaris. Please refresh.</div>';
    }
  }
}

// ---------- Filter helpers ----------
function populateCountryFilter() {
  const select = document.getElementById('countryFilter');
  if (!select) return;

  const countries = new Set();
  allSafaris.forEach(s => {
    if (s.location && s.location.includes(',')) {
      const country = s.location.split(',').pop().trim();
      countries.add(country);
    }
  });

  const sorted = [...countries].sort();
  select.innerHTML = '<option value="">All countries</option>' +
    sorted.map(c => `<option value="${c}">${c}</option>`).join('');
}

function applyFilters() {
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const country = document.getElementById('countryFilter')?.value || '';
  const priceRange = document.getElementById('priceFilter')?.value || '';
  const durationRange = document.getElementById('durationFilter')?.value || '';

  filteredSafaris = allSafaris.filter(s => {
    if (search) {
      const haystack = `${s.name} ${s.location} ${s.description}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (country && s.location && !s.location.endsWith(country)) return false;
    if (priceRange) {
      const [min, max] = priceRange.split('-').map(Number);
      if (s.price_pi < min || s.price_pi > max) return false;
    }
    if (durationRange) {
      const [min, max] = durationRange.split('-').map(Number);
      if (s.duration_days < min || s.duration_days > max) return false;
    }
    return true;
  });

  renderFilteredSafaris();
}

function renderFilteredSafaris() {
  const grid = document.getElementById('safariGrid');
  const countEl = document.getElementById('filterResultCount');
  if (!grid) return;

  if (filteredSafaris.length === 0) {
    grid.innerHTML = '<div class="empty-state">No safaris match your filters. Try clearing them.</div>';
    if (countEl) countEl.textContent = '';
    return;
  }

  if (countEl) {
    countEl.textContent = `Showing ${filteredSafaris.length} of ${allSafaris.length} safaris`;
  }

  grid.innerHTML = filteredSafaris.map(s => `
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

function attachFilterHandlers() {
  const search = document.getElementById('searchInput');
  const country = document.getElementById('countryFilter');
  const price = document.getElementById('priceFilter');
  const duration = document.getElementById('durationFilter');
  const clear = document.getElementById('clearFilters');

  if (search) search.addEventListener('input', applyFilters);
  if (country) country.addEventListener('change', applyFilters);
  if (price) price.addEventListener('change', applyFilters);
  if (duration) duration.addEventListener('change', applyFilters);

  if (clear) {
    clear.addEventListener('click', () => {
      if (search) search.value = '';
      if (country) country.value = '';
      if (price) price.value = '';
      if (duration) duration.value = '';
      applyFilters();
    });
  }
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

    renderFilteredSafaris();
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

// ---------- Booking ----------
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
            body: JSON.stringify({ paymentId, safariId: safari.id }),
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

// ---------- Bookings ----------
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
  if (!section || !list) return;

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

// ---------- Detail page ----------
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
    <a href="/" class="back-link">← Back to safaris</a>

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

// ---------- Listings page ----------
async function renderListingsPage() {
  document.getElementById('mainContent').innerHTML = `
    <section>
      <h2>🦁 Available Safaris</h2>

      <div class="filter-bar">
        <input
          type="text"
          id="searchInput"
          class="filter-search"
          placeholder="🔍 Search safaris, countries, parks..."
        />
        <select id="countryFilter" class="filter-select">
          <option value="">All countries</option>
        </select>
        <select id="priceFilter" class="filter-select">
          <option value="">All prices</option>
          <option value="0-5">Under 5 π</option>
          <option value="5-15">5 – 15 π</option>
          <option value="15-999">Over 15 π</option>
        </select>
        <select id="durationFilter" class="filter-select">
          <option value="">Any duration</option>
          <option value="1-2">1 – 2 days</option>
          <option value="3-5">3 – 5 days</option>
          <option value="6-99">6+ days</option>
        </select>
        <button id="clearFilters" class="clear-btn">Clear</button>
      </div>

      <div id="safariGrid" class="safari-grid">
        <div class="skeleton"></div>
        <div class="skeleton"></div>
        <div class="skeleton"></div>
      </div>
      <p id="filterResultCount" class="filter-count"></p>
    </section>
    <section class="bookings-section" id="bookingsSection" style="display:none;">
      <h2>🎫 My Bookings</h2>
      <div id="bookingsList"></div>
    </section>
  `;

  await loadSafaris();
  populateCountryFilter();
  attachFilterHandlers();

  if (accessToken) {
    loadBookings();
  }
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

function navigate(url) {
  history.pushState({}, '', url);
  route();
}

window.addEventListener('popstate', route);

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="/"]');
  if (link && !link.hasAttribute('onclick')) {
    e.preventDefault();
    navigate(link.getAttribute('href'));
  }
});

// ---------- Init ----------
route();