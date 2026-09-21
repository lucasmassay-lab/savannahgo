Pi.init({ version: "2.0", sandbox: false });

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
function showStatus(message, type) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = message;
  el.className = 'show ' + (type || 'info');
  setTimeout(function () { el.className = ''; }, 5000);
}

// ---------- Safari listing ----------
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

function populateCountryFilter() {
  const select = document.getElementById('countryFilter');
  if (!select) return;

  const countries = [];
  allSafaris.forEach(function (s) {
    if (s.location && s.location.indexOf(',') > -1) {
      const parts = s.location.split(',');
      const country = parts[parts.length - 1].trim();
      if (countries.indexOf(country) === -1) countries.push(country);
    }
  });

  countries.sort();
  select.innerHTML = '<option value="">All countries</option>' +
    countries.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
}

function applyFilters() {
  const searchEl = document.getElementById('searchInput');
  const countryEl = document.getElementById('countryFilter');
  const priceEl = document.getElementById('priceFilter');
  const durationEl = document.getElementById('durationFilter');

  const search = searchEl ? searchEl.value.toLowerCase() : '';
  const country = countryEl ? countryEl.value : '';
  const priceRange = priceEl ? priceEl.value : '';
  const durationRange = durationEl ? durationEl.value : '';

  filteredSafaris = allSafaris.filter(function (s) {
    if (search) {
      const haystack = (s.name + ' ' + s.location + ' ' + s.description).toLowerCase();
      if (haystack.indexOf(search) === -1) return false;
    }
    if (country && s.location && s.location.indexOf(country) === -1) return false;
    if (priceRange) {
      const parts = priceRange.split('-');
      const min = Number(parts[0]);
      const max = Number(parts[1]);
      if (s.price_pi < min || s.price_pi > max) return false;
    }
    if (durationRange) {
      const parts = durationRange.split('-');
      const min = Number(parts[0]);
      const max = Number(parts[1]);
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
    countEl.textContent = 'Showing ' + filteredSafaris.length + ' of ' + allSafaris.length + ' safaris';
  }

  grid.innerHTML = filteredSafaris.map(function (s) {
    const days = s.duration_days + ' day' + (s.duration_days > 1 ? 's' : '');
    return '<a href="/safari/' + s.id + '" class="safari-card">' +
      '<img src="' + s.image_url + '" alt="' + s.name + '" loading="lazy" />' +
      '<div class="safari-body">' +
        '<h3>' + s.name + '</h3>' +
        '<div class="safari-loc">📍 ' + s.location + '</div>' +
        '<div class="safari-desc">' + s.description + '</div>' +
        '<div class="safari-meta">' +
          '<div class="safari-price">' + s.price_pi + ' π <small>' + days + '</small></div>' +
          '<span class="view-btn">View →</span>' +
        '</div>' +
      '</div>' +
    '</a>';
  }).join('');
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
    clear.addEventListener('click', function () {
      if (search) search.value = '';
      if (country) country.value = '';
      if (price) price.value = '';
      if (duration) duration.value = '';
      applyFilters();
    });
  }
}

// ---------- Auth ----------
document.getElementById('login').onclick = async function () {
  try {
    const auth = await window.Pi.authenticate(
      ['username', 'payments'],
      onIncompletePayment
    );
    accessToken = auth.accessToken;
    currentUser = auth.user;
    await verifyOnServer(accessToken);

    const initial = (currentUser.username || '?').charAt(0).toUpperCase();
    document.getElementById('userInfo').innerHTML =
      '<div class="avatar">' + initial + '</div>' +
      '<span class="user-name">' + currentUser.username + '</span>';
    document.getElementById('login').style.display = 'none';

    renderFilteredSafaris();
    loadBookings();
    showStatus('Welcome, ' + currentUser.username + '!', 'success');
  } catch (err) {
    console.error('Auth failed', err);
    showStatus('Sign-in failed. Please try again.', 'error');
  }
};

async function verifyOnServer(token) {
  const res = await fetch('/api/verify', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
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
      txid: payment.transaction ? payment.transaction.txid : null,
    }),
  });
}

// ---------- Booking ----------
async function handleBookClick(safariId) {
  // If already signed in, go straight to booking
  if (accessToken) {
    bookSafari(safariId);
    return;
  }

  // Otherwise, trigger sign-in first
  showStatus('Please sign in to continue', 'info');

  try {
    const auth = await window.Pi.authenticate(
      ['username', 'payments'],
      onIncompletePayment
    );
    accessToken = auth.accessToken;
    currentUser = auth.user;
    await verifyOnServer(accessToken);

    const initial = (currentUser.username || '?').charAt(0).toUpperCase();
    document.getElementById('userInfo').innerHTML =
      '<div class="avatar">' + initial + '</div>' +
      '<span class="user-name">' + currentUser.username + '</span>';
    document.getElementById('login').style.display = 'none';

    showStatus('Welcome, ' + currentUser.username + '!', 'success');

    // Re-render the current page so the button updates
    route();

    // Small delay so the button state updates before the payment dialog opens
    setTimeout(function () { bookSafari(safariId); }, 300);
  } catch (err) {
    console.error('Sign-in failed', err);
    showStatus('Sign-in failed. Please try again.', 'error');
  }
}

function bookSafari(safariId) {
  const safari = safaris.find(function (s) { return s.id === safariId; });
  if (!safari) return;

  showStatus('Preparing payment for ' + safari.name + '...', 'info');

  window.Pi.createPayment(
    {
      amount: safari.price_pi,
      memo: 'Booking: ' + safari.name,
      metadata: { safari_id: safari.id, safari_name: safari.name },
    },
    {
      onReadyForServerApproval: async function (paymentId) {
        await fetch('/api/payments/approve', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessToken,
          },
          body: JSON.stringify({ paymentId: paymentId }),
        });
      },
      onReadyForServerCompletion: async function (paymentId, txid) {
        const res = await fetch('/api/payments/complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessToken,
          },
          body: JSON.stringify({ paymentId: paymentId, txid: txid }),
        });

        if (res.ok) {
          await fetch('/api/bookings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + accessToken,
            },
            body: JSON.stringify({ paymentId: paymentId, safariId: safari.id }),
          });

          showStatus('✅ Booking confirmed: ' + safari.name, 'success');
          showModal('<strong>' + safari.name + '</strong><br>' + safari.price_pi + ' π paid successfully');
          loadBookings();
        }
      },
      onCancel: function (paymentId) {
        console.log('Cancelled:', paymentId);
        showStatus('Payment cancelled.', 'info');
      },
      onError: function (error, payment) {
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
      headers: { Authorization: 'Bearer ' + accessToken },
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
  list.innerHTML = bookings.map(function (b) {
      return '<a href="/booking/' + b.id + '" class="booking-row">' +
      '<div class="booking-info">' +
        '<strong>' + b.safari_name + '</strong>' +
        '<small>' + b.price_pi + ' π • ' + new Date(b.created_at).toLocaleDateString() + '</small>' +
      '</div>' +
      '<span class="booking-status status-' + b.status + '">' + b.status + '</span>' +
    '</a>';
  }).join('');
}

// ---------- Detail page ----------
async function renderDetailPage(id) {
  const container = document.getElementById('mainContent');
  container.innerHTML = '<div class="skeleton" style="height:400px;"></div>';

  try {
    const res = await fetch('/api/safaris/' + id);
    if (!res.ok) {
      container.innerHTML = '<div class="empty-state">Safari not found.</div>';
      return;
    }
    const data = await res.json();
    renderSafariDetail(data.safari, data.rating);
  } catch (err) {
    console.error('Failed to load safari', err);
    container.innerHTML = '<div class="empty-state">Could not load safari.</div>';
  }
}

function renderStars(rating) {
  if (!rating) return '☆☆☆☆☆';
  const full = Math.round(rating);
  let stars = '';
  for (let i = 0; i < full; i++) stars += '★';
  for (let i = full; i < 5; i++) stars += '☆';
  return stars;
}

function renderSafariDetail(s, rating) {
  const container = document.getElementById('mainContent');
  const avg = rating && rating.average ? rating.average : null;
  const count = rating && rating.count ? rating.count : 0;
  const days = s.duration_days + ' day' + (s.duration_days > 1 ? 's' : '');

  const ratingHtml = count > 0
    ? '<div class="rating-summary"><span class="stars">' + renderStars(avg) + '</span><span class="rating-text">' + avg + ' · ' + count + ' review' + (count > 1 ? 's' : '') + '</span></div>'
    : '<div class="rating-summary no-reviews">No reviews yet — be the first!</div>';

  container.innerHTML =
    '<a href="/" class="back-link">← Back to safaris</a>' +
    '<div class="detail-hero">' +
      '<img src="' + s.image_url + '" alt="' + s.name + '" />' +
      '<div class="detail-overlay">' +
        '<h1>' + s.name + '</h1>' +
        '<div class="detail-loc">📍 ' + s.location + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="detail-body">' +
      '<div class="detail-meta">' +
        '<div class="detail-price">' + s.price_pi + ' π</div>' +
        '<div class="detail-duration">' + days + '</div>' +
      '</div>' +
      ratingHtml +
      '<h2>About this safari</h2>' +
      '<p>' + s.description + '</p>' +
      (s.itinerary ? '<h2>Itinerary</h2><p>' + s.itinerary + '</p>' : '') +
      (s.includes ? '<h2>What\'s included</h2><p>' + s.includes + '</p>' : '') +
      (s.terms ? '<h2>Terms &amp; conditions</h2><p>' + s.terms + '</p>' : '') +
      '<button class="book-btn-large" onclick="handleBookClick(' + s.id + ')">' +
        (accessToken ? 'Book for ' + s.price_pi + ' π' : '🔒 Sign in to book') +
      '</button>' +
    '</div>' +
    '<div class="reviews-section" id="reviewsSection">' +
      '<h2>⭐ Reviews</h2>' +
      '<div id="reviewsList">Loading reviews...</div>' +
      '<div id="reviewFormContainer"></div>' +
    '</div>';

  loadReviews(s.id);
}

// ---------- Reviews ----------
async function loadReviews(safariId) {
  const list = document.getElementById('reviewsList');
  if (!list) return;

  try {
    const res = await fetch('/api/safaris/' + safariId + '/reviews');
    const data = await res.json();
    const reviews = data.reviews || [];

    if (reviews.length === 0) {
      list.innerHTML = '<p class="no-reviews-text">No reviews yet.</p>';
    } else {
      list.innerHTML = reviews.map(function (r) {
        return '<div class="review-card">' +
          '<div class="review-header">' +
            '<div class="review-avatar">' + (r.username || '?').charAt(0).toUpperCase() + '</div>' +
            '<div>' +
              '<div class="review-user">' + (r.username || 'Pioneer') + '</div>' +
              '<div class="review-date">' + new Date(r.created_at).toLocaleDateString() + '</div>' +
            '</div>' +
            '<div class="review-stars">' + renderStars(r.rating) + '</div>' +
          '</div>' +
          (r.comment ? '<p class="review-comment">' + r.comment + '</p>' : '') +
        '</div>';
      }).join('');
    }

    renderReviewForm(safariId);
  } catch (err) {
    console.error('Failed to load reviews', err);
    list.innerHTML = '<p>Could not load reviews.</p>';
  }
}

function renderReviewForm(safariId) {
  const container = document.getElementById('reviewFormContainer');
  if (!container) return;

  if (!accessToken) {
    container.innerHTML = '<p class="review-hint">Sign in to leave a review.</p>';
    return;
  }

  let starHtml = '';
  for (let i = 1; i <= 5; i++) {
    starHtml += '<span class="star" data-value="' + i + '" onclick="setRating(' + i + ')">☆</span>';
  }

  container.innerHTML =
    '<div class="review-form">' +
      '<h3>Leave a review</h3>' +
      '<div class="star-input" id="starInput">' + starHtml + '</div>' +
      '<textarea id="reviewComment" placeholder="Share your experience (optional)" rows="3"></textarea>' +
      '<button onclick="submitReview(' + safariId + ')">Submit Review</button>' +
      '<p class="review-hint">You must have booked this safari to submit a review.</p>' +
    '</div>';
}

let currentRating = 0;

function setRating(value) {
  currentRating = value;
  const stars = document.querySelectorAll('#starInput .star');
  stars.forEach(function (el, idx) {
    el.textContent = (idx + 1) <= value ? '★' : '☆';
  });
}

async function submitReview(safariId) {
  if (!currentRating) {
    showStatus('Please select a star rating', 'error');
    return;
  }
  const commentEl = document.getElementById('reviewComment');
  const comment = commentEl ? commentEl.value : '';

  try {
    const res = await fetch('/api/safaris/' + safariId + '/reviews', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken,
      },
      body: JSON.stringify({ rating: currentRating, comment: comment }),
    });

    if (!res.ok) {
      const err = await res.json();
      showStatus(err.error || 'Could not submit review', 'error');
      return;
    }

    showStatus('✅ Review submitted!', 'success');
    currentRating = 0;
    loadReviews(safariId);
  } catch (err) {
    console.error('Failed to submit review', err);
    showStatus('Could not submit review', 'error');
  }
}

// ---------- Listings page ----------
async function renderListingsPage() {
  document.getElementById('mainContent').innerHTML =
    '<section>' +
      '<h2>🦁 Available Safaris</h2>' +
      '<div class="filter-bar">' +
        '<input type="text" id="searchInput" class="filter-search" placeholder="🔍 Search safaris, countries, parks..." />' +
        '<select id="countryFilter" class="filter-select"><option value="">All countries</option></select>' +
        '<select id="priceFilter" class="filter-select">' +
          '<option value="">All prices</option>' +
          '<option value="0-5">Under 5 π</option>' +
          '<option value="5-15">5 – 15 π</option>' +
          '<option value="15-999">Over 15 π</option>' +
        '</select>' +
        '<select id="durationFilter" class="filter-select">' +
          '<option value="">Any duration</option>' +
          '<option value="1-2">1 – 2 days</option>' +
          '<option value="3-5">3 – 5 days</option>' +
          '<option value="6-99">6+ days</option>' +
        '</select>' +
        '<button id="clearFilters" class="clear-btn">Clear</button>' +
      '</div>' +
      '<div id="safariGrid" class="safari-grid">' +
        '<div class="skeleton"></div>' +
        '<div class="skeleton"></div>' +
        '<div class="skeleton"></div>' +
      '</div>' +
      '<p id="filterResultCount" class="filter-count"></p>' +
    '</section>' +
    '<section class="bookings-section" id="bookingsSection" style="display:none;">' +
      '<h2>🎫 My Bookings</h2>' +
      '<div id="bookingsList"></div>' +
    '</section>';

  await loadSafaris();
  populateCountryFilter();
  attachFilterHandlers();

  if (accessToken) {
    loadBookings();
  }
}

// ---------- Booking detail page ----------
async function renderBookingDetailPage(bookingId) {
  const container = document.getElementById('mainContent');
  container.innerHTML = '<div class="skeleton" style="height:400px;"></div>';

  if (!accessToken) {
    container.innerHTML = '<div class="empty-state">Please sign in to view this booking.</div>';
    return;
  }

  try {
    const res = await fetch('/api/bookings/' + bookingId, {
      headers: { Authorization: 'Bearer ' + accessToken },
    });

    if (!res.ok) {
      container.innerHTML = '<div class="empty-state">Booking not found.</div>';
      return;
    }

    const data = await res.json();
    renderBookingDetail(data.booking);
  } catch (err) {
    console.error('Failed to load booking', err);
    container.innerHTML = '<div class="empty-state">Could not load booking.</div>';
  }
}

function renderBookingDetail(b) {
  const container = document.getElementById('mainContent');
  const days = b.duration_days
    ? b.duration_days + ' day' + (b.duration_days > 1 ? 's' : '')
    : '—';
  const txid = b.txid || 'Not available';
  const explorerUrl = b.txid
    ? 'https://blockexplorer.minepi.com/transactions/' + b.txid
    : null;

  container.innerHTML =
    '<a href="/" class="back-link">← Back to safaris</a>' +
    '<div class="booking-detail">' +
      '<div class="booking-detail-header">' +
        '<div class="booking-status-badge status-' + b.status + '">' + b.status + '</div>' +
        '<h1>' + b.safari_name + '</h1>' +
        '<p class="booking-detail-loc">📍 ' + (b.location || 'Location unavailable') + '</p>' +
      '</div>' +
      (b.image_url
        ? '<img class="booking-detail-image" src="' + b.image_url + '" alt="' + b.safari_name + '" />'
        : '') +
      '<div class="booking-detail-grid">' +
        '<div class="booking-detail-item">' +
          '<div class="detail-label">Amount paid</div>' +
          '<div class="detail-value">' + b.price_pi + ' π</div>' +
        '</div>' +
        '<div class="booking-detail-item">' +
          '<div class="detail-label">Duration</div>' +
          '<div class="detail-value">' + days + '</div>' +
        '</div>' +
        '<div class="booking-detail-item">' +
          '<div class="detail-label">Booked on</div>' +
          '<div class="detail-value">' + new Date(b.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + '</div>' +
        '</div>' +
        '<div class="booking-detail-item">' +
          '<div class="detail-label">Booking ID</div>' +
          '<div class="detail-value detail-mono">#' + b.id + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="booking-detail-section">' +
        '<div class="detail-label">Payment ID</div>' +
        '<div class="detail-value detail-mono detail-break">' + b.payment_id + '</div>' +
      '</div>' +
      '<div class="booking-detail-section">' +
        '<div class="detail-label">Blockchain transaction (TXID)</div>' +
        '<div class="detail-value detail-mono detail-break">' + txid + '</div>' +
        (explorerUrl
          ? '<a class="explorer-link" href="' + explorerUrl + '" target="_blank" rel="noopener">View on Pi Blockchain Explorer →</a>'
          : '<p class="detail-hint">Transaction is still processing or unavailable.</p>') +
      '</div>' +
      '<div class="booking-detail-actions">' +
        '<button onclick="navigate(\'/safari/' + b.safari_id + '\')">View Safari</button>' +
        '<button class="btn-secondary" onclick="navigate(\'/\')">Back to Listings</button>' +
      '</div>' +
    '</div>';
}// ---------- Router ----------
function route() {
  const path = window.location.pathname;

  if (path === '/' || path === '/index.html') {
    renderListingsPage();
  } else if (path.indexOf('/safari/') === 0) {
    const id = path.split('/')[2];
    renderDetailPage(id);
  } else if (path.indexOf('/booking/') === 0) {
    const id = path.split('/')[2];
    renderBookingDetailPage(id);
  } else {
    renderListingsPage();
  }
}
console.log('APP LOADED. Path =', window.location.pathname);


// ---------- Navigation ----------
function navigate(url) {
  history.pushState({}, '', url);
  route();
}

window.addEventListener('popstate', route);

document.addEventListener('click', function (e) {
  var link = e.target.closest ? e.target.closest('a[href^="/"]') : null;
  if (link && !link.hasAttribute('onclick')) {
    e.preventDefault();
    navigate(link.getAttribute('href'));
  }
});

// ---------- Init ----------
route();