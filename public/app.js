Pi.init({ version: "2.0", sandbox: false });

let accessToken = null;
let currentUser = null;
let safaris = [];
let allSafaris = [];
let filteredSafaris = [];
let currentRating = 0;
let adminKey = null;
let adminTab = 'safaris';

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
    const heart = isWishlisted(s.id) ? '❤️' : '🤍';
    return '<div class="safari-card-wrap">' +
      '<button class="heart-btn" onclick="toggleWishlist(' + s.id + ', event)" title="Save to favorites">' + heart + '</button>' +
      '<a href="/safari/' + s.id + '" class="safari-card">' +
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
      '</a>' +
    '</div>';
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
  if (accessToken) {
    bookSafari(safariId);
    return;
  }

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
    route();
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
// ---------- Wishlist ----------
let userWishlist = [];

async function loadWishlist() {
  if (!accessToken) {
    userWishlist = [];
    return;
  }
  try {
    const res = await fetch('/api/wishlist', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (!res.ok) return;
    const data = await res.json();
    userWishlist = (data.wishlist || []).map(function (w) { return w.safari_id; });
    renderWishlistSection(data.wishlist || []);
  } catch (err) {
    console.error('Failed to load wishlist', err);
  }
}

function isWishlisted(safariId) {
  return userWishlist.indexOf(safariId) > -1;
}

async function toggleWishlist(safariId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!accessToken) {
    showStatus('Sign in to save favorites', 'info');
    return;
  }

  const isSaved = isWishlisted(safariId);

  try {
    const res = await fetch('/api/wishlist' + (isSaved ? '/' + safariId : ''), {
      method: isSaved ? 'DELETE' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken,
      },
      body: isSaved ? null : JSON.stringify({ safariId: safariId }),
    });

    if (res.ok) {
      if (isSaved) {
        userWishlist = userWishlist.filter(function (id) { return id !== safariId; });
        showStatus('Removed from favorites', 'info');
      } else {
        userWishlist.push(safariId);
        showStatus('❤️ Added to favorites', 'success');
      }
      if (window.location.pathname === '/') {
        renderFilteredSafaris();
        loadWishlist();
      } else if (window.location.pathname.indexOf('/safari/') === 0) {
        route();
      }
    } else {
      const errBody = await res.text();
      console.error('WISHLIST ERROR', res.status, errBody);
      alert('Wishlist error: ' + res.status + ' - ' + errBody);
      showStatus('Could not update favorites', 'error');
    }
  } catch (err) {
    console.error(err);
    showStatus('Error updating favorites', 'error');
  }
}

function renderWishlistSection(items) {
  const section = document.getElementById('wishlistSection');
  const list = document.getElementById('wishlistList');
  if (!section || !list) return;

  if (!items || items.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = items.map(function (s) {
    return '<a href="/safari/' + s.safari_id + '" class="safari-card">' +
      '<img src="' + s.image_url + '" alt="' + s.name + '" loading="lazy" />' +
      '<div class="safari-body">' +
        '<h3>' + s.name + '</h3>' +
        '<div class="safari-loc">📍 ' + s.location + '</div>' +
        '<div class="safari-meta">' +
          '<div class="safari-price">' + s.price_pi + ' π</div>' +
          '<span class="view-btn">View →</span>' +
        '</div>' +
      '</div>' +
    '</a>';
  }).join('');
}

// ---------- Safari detail ----------
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

async function shareSafari(safariId, safariName, pricePi) {
  const url = window.location.origin + '/safari/' + safariId;
  const text = 'Check out "' + safariName + '" (' + pricePi + ' π) on SavannahGo — African safaris on Pi!';

  if (navigator.share) {
    try {
      await navigator.share({ title: safariName, text: text, url: url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  const whatsappUrl = 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + url);
  try {
    await navigator.clipboard.writeText(text + ' ' + url);
    showStatus('Link copied to clipboard! Paste it to share.', 'success');
  } catch (err) {
    window.open(whatsappUrl, '_blank');
  }
}

function renderSafariDetail(s, rating) {
  const container = document.getElementById('mainContent');
  const avg = rating && rating.average ? rating.average : null;
  const count = rating && rating.count ? rating.count : 0;
  const days = s.duration_days + ' day' + (s.duration_days > 1 ? 's' : '');  const heart = isWishlisted(s.id) ? '❤️' : '🤍';

  const ratingHtml = count > 0
    ? '<div class="rating-summary"><span class="stars">' + renderStars(avg) + '</span><span class="rating-text">' + avg + ' · ' + count + ' review' + (count > 1 ? 's' : '') + '</span></div>'
    : '<div class="rating-summary no-reviews">No reviews yet — be the first!</div>';

  container.innerHTML =
    '<a href="/" class="back-link">← Back to safaris</a>' +
      '<div class="detail-hero">' +
      '<button class="heart-btn heart-btn-large" onclick="toggleWishlist(' + s.id + ', event)" title="Save to favorites">' + heart + '</button>' +
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
      '<button class="share-btn" onclick="shareSafari(' + s.id + ', \'' + s.name.replace(/'/g, "\\'") + '\', ' + s.price_pi + ')">📤 Share this safari</button>' +
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
    '<section class="bookings-section" id="wishlistSection" style="display:none;">' +
      '<h2>❤️ My Favorites</h2>' +
      '<div id="wishlistList" class="safari-grid"></div>' +
    '</section>' +
    '<section class="bookings-section" id="bookingsSection" style="display:none;">' +
      '<h2>🎫 My Bookings</h2>' +
      '<div id="bookingsList"></div>' +
    '</section>';

  await loadSafaris();
  populateCountryFilter();
  attachFilterHandlers();

  if (accessToken) {
    loadWishlist();
    loadBookings();
  }
}

// ---------- Booking detail ----------
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
  const days = b.duration_days ? b.duration_days + ' day' + (b.duration_days > 1 ? 's' : '') : '—';
  const txid = b.txid || 'Not available';
  const explorerUrl = b.txid ? 'https://blockexplorer.minepi.com/transactions/' + b.txid : null;

  container.innerHTML =
    '<a href="/" class="back-link">← Back to safaris</a>' +
    '<div class="booking-detail">' +
      '<div class="booking-detail-header">' +
        '<div class="booking-status-badge status-' + b.status + '">' + b.status + '</div>' +
        '<h1>' + b.safari_name + '</h1>' +
        '<p class="booking-detail-loc">📍 ' + (b.location || 'Location unavailable') + '</p>' +
      '</div>' +
      (b.image_url ? '<img class="booking-detail-image" src="' + b.image_url + '" alt="' + b.safari_name + '" />' : '') +
      '<div class="booking-detail-grid">' +
        '<div class="booking-detail-item"><div class="detail-label">Amount paid</div><div class="detail-value">' + b.price_pi + ' π</div></div>' +
        '<div class="booking-detail-item"><div class="detail-label">Duration</div><div class="detail-value">' + days + '</div></div>' +
        '<div class="booking-detail-item"><div class="detail-label">Booked on</div><div class="detail-value">' + new Date(b.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + '</div></div>' +
        '<div class="booking-detail-item"><div class="detail-label">Booking ID</div><div class="detail-value detail-mono">#' + b.id + '</div></div>' +
      '</div>' +
      '<div class="booking-detail-section"><div class="detail-label">Payment ID</div><div class="detail-value detail-mono detail-break">' + b.payment_id + '</div></div>' +
      '<div class="booking-detail-section">' +
        '<div class="detail-label">Blockchain transaction (TXID)</div>' +
        '<div class="detail-value detail-mono detail-break">' + txid + '</div>' +
        (explorerUrl ? '<a class="explorer-link" href="' + explorerUrl + '" target="_blank" rel="noopener">View on Pi Blockchain Explorer →</a>' : '<p class="detail-hint">Transaction is still processing or unavailable.</p>') +
      '</div>' +
      '<div class="booking-detail-actions">' +
        '<button onclick="navigate(\'/safari/' + b.safari_id + '\')">View Safari</button>' +
        '<button class="btn-secondary" onclick="navigate(\'/\')">Back to Listings</button>' +
      '</div>' +
    '</div>';
}

// ---------- Admin panel ----------
function renderAdminPage() {
  const container = document.getElementById('mainContent');

  if (!adminKey) {
    container.innerHTML =
      '<div class="admin-login">' +
        '<h2>🔐 Admin Login</h2>' +
        '<p>Enter your admin key to manage safaris.</p>' +
        '<input type="password" id="adminKeyInput" placeholder="Admin key" />' +
        '<button onclick="adminLogin()">Sign In</button>' +
        '<p id="adminError" class="admin-error"></p>' +
      '</div>';
    return;
  }

  const tab = adminTab || 'safaris';

  container.innerHTML =
    '<div class="admin-header">' +
      '<h2>🛠️ Admin Panel</h2>' +
      '<div>' +
        (tab === 'safaris' ? '<button onclick="showNewSafariForm()">+ New Safari</button>' : '') +
        '<button class="btn-secondary" onclick="adminLogout()">Log Out</button>' +
      '</div>' +
    '</div>' +
    '<div class="admin-tabs">' +
      '<button class="admin-tab ' + (tab === 'safaris' ? 'active' : '') + '" onclick="switchAdminTab(\'safaris\')">Safaris</button>' +
      '<button class="admin-tab ' + (tab === 'bookings' ? 'active' : '') + '" onclick="switchAdminTab(\'bookings\')">Bookings</button>' +
      '<button class="admin-tab ' + (tab === 'messages' ? 'active' : '') + '" onclick="switchAdminTab(\'messages\')">Messages</button>' +
    '</div>' +
    '<div id="adminContent">Loading...</div>';

  if (tab === 'messages') {
    loadAdminMessages();
  } else if (tab === 'bookings') {
    loadAdminBookings();
  } else {
    loadAdminSafaris();
  }
}


function adminLogin() {
  const input = document.getElementById('adminKeyInput');
  const key = input ? input.value.trim() : '';
  if (!key) return;

  adminKey = key;
  fetch('/api/admin/safaris', { headers: { 'x-admin-key': adminKey } })
    .then(function (r) {
      if (r.ok) {
        renderAdminPage();
      } else {
        adminKey = null;
        const err = document.getElementById('adminError');
        if (err) err.textContent = 'Invalid admin key. Try again.';
      }
    })
    .catch(function () {
      adminKey = null;
      const err = document.getElementById('adminError');
      if (err) err.textContent = 'Could not connect. Try again.';
    });
}

function adminLogout() {
  adminKey = null;
  adminTab = 'safaris';
  renderAdminPage();
}

function switchAdminTab(tab) {
  adminTab = tab;
  renderAdminPage();
}

// ---------- Admin: Messages tab ----------
async function loadAdminMessages() {
  const content = document.getElementById('adminContent');
  if (!content) return;

  content.innerHTML = 'Loading messages...';

  try {
    const res = await fetch('/api/admin/messages', {
      headers: { 'x-admin-key': adminKey },
    });
    if (!res.ok) {
      content.innerHTML = '<p>Error loading messages.</p>';
      return;
    }
    const data = await res.json();
    renderAdminMessages(data.messages || []);
  } catch (err) {
    console.error(err);
    content.innerHTML = '<p>Error loading messages.</p>';
  }
}

function renderAdminMessages(messages) {
  const content = document.getElementById('adminContent');
  if (!content) return;

  if (messages.length === 0) {
    content.innerHTML = '<p class="empty-state">No messages yet. When someone fills the contact form, it will appear here.</p>';
    return;
  }

  let rows = '';
  messages.forEach(function (m) {
    const date = new Date(m.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const statusClass = m.status === 'new' ? 'status-new' : (m.status === 'replied' ? 'status-completed' : 'status-pending');
    const safeName = (m.name || 'Anonymous').replace(/'/g, "\\'");

    rows += '<div class="message-card ' + (m.status === 'new' ? 'message-new' : '') + '">' +
      '<div class="message-header">' +
        '<div>' +
          '<strong>' + (m.name || 'Anonymous') + '</strong>' +
          '<span class="message-contact">' + (m.contact || 'No contact info') + '</span>' +
        '</div>' +
        '<span class="booking-status ' + statusClass + '">' + m.status + '</span>' +
      '</div>' +
      (m.safari_name ? '<div class="message-safari">🎯 Interested in: ' + m.safari_name + '</div>' : '') +
      '<p class="message-text">' + (m.message || '') + '</p>' +
      '<div class="message-footer">' +
        '<span class="message-date">' + date + '</span>' +
        '<div class="message-actions">' +
          (m.status === 'new' ? '<button onclick="markMessage(' + m.id + ', \'read\')">Mark read</button>' : '') +
          (m.status !== 'replied' ? '<button onclick="markMessage(' + m.id + ', \'replied\')">Mark replied</button>' : '') +
          '<button class="btn-danger" onclick="deleteMessage(' + m.id + ', \'' + safeName + '\')">Delete</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  });

  content.innerHTML = rows;
}

async function markMessage(id, status) {
  try {
    const res = await fetch('/api/admin/messages/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ status: status }),
    });
    if (res.ok) {
      loadAdminMessages();
    } else {
      showStatus('Could not update message', 'error');
    }
  } catch (err) {
    console.error(err);
    showStatus('Error updating message', 'error');
  }
}

async function deleteMessage(id, name) {
  if (!confirm('Delete message from "' + name + '"? This cannot be undone.')) return;
  try {
    const res = await fetch('/api/admin/messages/' + id, {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey },
    });
    if (res.ok) {
      showStatus('Message deleted', 'success');
      loadAdminMessages();
    } else {
      showStatus('Could not delete', 'error');
    }
  } catch (err) {
    console.error(err);
    showStatus('Error deleting', 'error');
  }
}
// ---------- Admin: Bookings tab ----------
async function loadAdminBookings() {
  const content = document.getElementById('adminContent');
  if (!content) return;

  content.innerHTML = 'Loading bookings...';

  try {
    const res = await fetch('/api/admin/bookings', {
      headers: { 'x-admin-key': adminKey },
    });
    if (!res.ok) {
      content.innerHTML = '<p>Error loading bookings.</p>';
      return;
    }
    const data = await res.json();
    renderAdminBookings(data.bookings || [], data.summary || { total_count: 0, total_pi: 0 });
  } catch (err) {
    console.error(err);
    content.innerHTML = '<p>Error loading bookings.</p>';
  }
}

function renderAdminBookings(bookings, summary) {
  const content = document.getElementById('adminContent');
  if (!content) return;

  const summaryHtml =
    '<div class="booking-summary">' +
      '<div class="summary-item">' +
        '<div class="summary-label">Total Bookings</div>' +
        '<div class="summary-value">' + summary.total_count + '</div>' +
      '</div>' +
      '<div class="summary-item">' +
        '<div class="summary-label">Total Pi Earned</div>' +
        '<div class="summary-value">' + summary.total_pi + ' π</div>' +
      '</div>' +
    '</div>';

  if (bookings.length === 0) {
    content.innerHTML = summaryHtml + '<p class="empty-state">No bookings yet.</p>';
    return;
  }

  let rows = '';
  bookings.forEach(function (b) {
    const date = new Date(b.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
    const txidShort = b.txid ? b.txid.substring(0, 10) + '...' : '—';

    rows += '<tr>' +
      '<td class="detail-mono">#' + b.id + '</td>' +
      '<td>' + (b.username || 'Anonymous') + '</td>' +
      '<td>' + b.safari_name + '</td>' +
      '<td><strong>' + b.price_pi + ' π</strong></td>' +
      '<td><span class="booking-status status-' + b.status + '">' + b.status + '</span></td>' +
      '<td class="detail-mono detail-break">' + txidShort + '</td>' +
      '<td>' + date + '</td>' +
      '<td>' + (b.txid ? '<a class="explorer-link" href="https://blockexplorer.minepi.com/transactions/' + b.txid + '" target="_blank">View</a>' : '—') + '</td>' +
    '</tr>';
  });

  content.innerHTML =
    summaryHtml +
    '<div style="overflow-x: auto;">' +
      '<table class="admin-table">' +
        '<thead><tr>' +
          '<th>ID</th><th>User</th><th>Safari</th><th>Amount</th>' +
          '<th>Status</th><th>TXID</th><th>Date</th><th>TX</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
}
// ---------- Admin: Safaris tab ----------
async function loadAdminSafaris() {
  const content = document.getElementById('adminContent');
  if (!content) return;

  try {
    const res = await fetch('/api/admin/safaris', {
      headers: { 'x-admin-key': adminKey },
    });
    if (!res.ok) {
      content.innerHTML = '<p>Error loading safaris.</p>';
      return;
    }
    const data = await res.json();
    renderAdminList(data.safaris || []);
  } catch (err) {
    console.error(err);
    content.innerHTML = '<p>Error loading safaris.</p>';
  }
}

function renderAdminList(safaris) {
  const content = document.getElementById('adminContent');
  if (!content) return;

  if (safaris.length === 0) {
    content.innerHTML = '<p class="empty-state">No safaris yet. Click "+ New Safari" to add one.</p>';
    return;
  }

  let rows = '';
  safaris.forEach(function (s) {
    const safeName = s.name.replace(/'/g, "\\'");
    rows += '<tr>' +
      '<td>' + s.id + '</td>' +
      '<td>' + s.name + '</td>' +
      '<td>' + s.price_pi + ' π</td>' +
      '<td>' + (s.active ? '✅' : '❌') + '</td>' +
      '<td>' +
        '<button onclick="editSafari(' + s.id + ')">Edit</button>' +
        '<button class="btn-danger" onclick="deleteSafari(' + s.id + ', \'' + safeName + '\')">Delete</button>' +
      '</td>' +
    '</tr>';
  });

  content.innerHTML =
    '<table class="admin-table">' +
      '<thead><tr><th>ID</th><th>Name</th><th>Price</th><th>Active</th><th>Actions</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>';
}

// ---------- Admin: Safari form ----------
function showNewSafariForm() {
  showSafariForm(null);
}

async function editSafari(id) {
  try {
    const res = await fetch('/api/admin/safaris', {
      headers: { 'x-admin-key': adminKey },
    });
    if (!res.ok) return;
    const data = await res.json();
    const safari = (data.safaris || []).find(function (s) { return s.id === id; });
    if (!safari) {
      showStatus('Safari not found', 'error');
      return;
    }
    showSafariForm(safari);
  } catch (err) {
    console.error(err);
    showStatus('Error loading safari', 'error');
  }
}

function showSafariForm(safari) {
  const isEdit = !!safari;
  const s = safari || {
    name: '', location: '', description: '', price_pi: '',
    duration_days: 1, image_url: '', itinerary: '',
    includes: '', terms: '', active: 1,
  };

  const content = document.getElementById('adminContent');
  content.innerHTML =
    '<div class="admin-form">' +
      '<h3>' + (isEdit ? 'Edit Safari #' + s.id : 'New Safari') + '</h3>' +
      '<label>Name *<input type="text" id="f_name" value="' + esc(s.name) + '" /></label>' +
      '<label>Location<input type="text" id="f_location" value="' + esc(s.location) + '" /></label>' +
      '<label>Description<textarea id="f_description" rows="2">' + esc(s.description) + '</textarea></label>' +
      '<label>Price in Pi *<input type="number" step="0.01" id="f_price_pi" value="' + s.price_pi + '" /></label>' +
      '<label>Duration (days)<input type="number" id="f_duration_days" value="' + s.duration_days + '" /></label>' +
      '<label>Image URL<input type="text" id="f_image_url" value="' + esc(s.image_url) + '" /></label>' +
      '<label>Itinerary<textarea id="f_itinerary" rows="3">' + esc(s.itinerary) + '</textarea></label>' +
      '<label>Includes<textarea id="f_includes" rows="2">' + esc(s.includes) + '</textarea></label>' +
      '<label>Terms<textarea id="f_terms" rows="2">' + esc(s.terms) + '</textarea></label>' +
      '<label class="checkbox-label"><input type="checkbox" id="f_active"' + (s.active ? ' checked' : '') + ' /> Active (visible to users)</label>' +
      '<div class="admin-form-actions">' +
        '<button onclick="saveSafari(' + (isEdit ? s.id : 'null') + ')">Save</button>' +
        '<button class="btn-secondary" onclick="cancelSafariForm()">Cancel</button>' +
      '</div>' +
    '</div>';
}

function cancelSafariForm() {
  loadAdminSafaris();
}

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function saveSafari(id) {
  const body = {
    name: document.getElementById('f_name').value.trim(),
    location: document.getElementById('f_location').value.trim(),
    description: document.getElementById('f_description').value.trim(),
    price_pi: parseFloat(document.getElementById('f_price_pi').value) || 0,
    duration_days: parseInt(document.getElementById('f_duration_days').value, 10) || 1,
    image_url: document.getElementById('f_image_url').value.trim(),
    itinerary: document.getElementById('f_itinerary').value.trim(),
    includes: document.getElementById('f_includes').value.trim(),
    terms: document.getElementById('f_terms').value.trim(),
    active: document.getElementById('f_active').checked ? 1 : 0,
  };

  if (!body.name) { showStatus('Name is required', 'error'); return; }
  if (!body.price_pi) { showStatus('Price is required', 'error'); return; }

  try {
    const url = id ? '/api/admin/safaris/' + id : '/api/admin/safaris';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      showStatus(id ? 'Safari updated' : 'Safari created', 'success');
      loadAdminSafaris();
    } else {
      const err = await res.json();
      showStatus(err.error || 'Could not save', 'error');
    }
  } catch (err) {
    console.error(err);
    showStatus('Error saving safari', 'error');
  }
}

async function deleteSafari(id, name) {
  if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
  try {
    const res = await fetch('/api/admin/safaris/' + id, {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey },
    });
    if (res.ok) {
      showStatus('Safari deleted', 'success');
      loadAdminSafaris();
    } else {
      showStatus('Could not delete', 'error');
    }
  } catch (err) {
    console.error(err);
    showStatus('Error deleting', 'error');
  }
}

// ---------- Contact page ----------
function renderContactPage() {
  const container = document.getElementById('mainContent');
  container.innerHTML =
    '<div class="contact-page">' +
      '<h2>📬 Contact SavannahGo</h2>' +
      '<p class="contact-intro">Have a question about a safari, a custom booking, or just want to say hi? Send us a message and we\'ll get back to you.</p>' +
      '<div class="contact-form">' +
        '<label>Your name<input type="text" id="c_name" placeholder="e.g. Saige" /></label>' +
        '<label>How can we reach you?<input type="text" id="c_contact" placeholder="Email, WhatsApp, or Pi username" /></label>' +
        '<label>Which safari are you interested in?<select id="c_safari"><option value="">General inquiry</option></select></label>' +
        '<label>Message *<textarea id="c_message" rows="5" placeholder="Tell us what you\'d like to know..."></textarea></label>' +
        '<button onclick="submitContact()">Send Message</button>' +
        '<p id="contactResult" class="contact-result"></p>' +
      '</div>' +
    '</div>';

  populateContactSafariDropdown();
}

async function populateContactSafariDropdown() {
  const select = document.getElementById('c_safari');
  if (!select) return;

  try {
    const res = await fetch('/api/safaris');
    const data = await res.json();
    const safaris = data.safaris || [];

    safaris.forEach(function (s) {
      const option = document.createElement('option');
      option.value = s.id;
      option.textContent = s.name + ' (' + s.price_pi + ' π)';
      select.appendChild(option);
    });
  } catch (err) {
    console.error('Failed to load safaris for contact form', err);
  }
}

async function submitContact() {
  const name = (document.getElementById('c_name') || {}).value || '';
  const contact = (document.getElementById('c_contact') || {}).value || '';
  const safariId = (document.getElementById('c_safari') || {}).value || '';
  const message = (document.getElementById('c_message') || {}).value || '';
  const result = document.getElementById('contactResult');

  if (!message.trim() || message.trim().length < 3) {
    result.textContent = 'Please write a message (at least 3 characters).';
    result.className = 'contact-result error';
    return;
  }

  const safariSelect = document.getElementById('c_safari');
  const safariName = safariId && safariSelect
    ? safariSelect.options[safariSelect.selectedIndex].textContent
    : '';

  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        contact: contact.trim(),
        safari_id: safariId ? parseInt(safariId, 10) : null,
        safari_name: safariName,
        message: message.trim(),
      }),
    });

    if (res.ok) {
      result.textContent = '✅ Message sent! We\'ll be in touch soon.';
      result.className = 'contact-result success';
      document.getElementById('c_name').value = '';
      document.getElementById('c_contact').value = '';
      document.getElementById('c_safari').value = '';
      document.getElementById('c_message').value = '';
    } else {
      result.textContent = 'Could not send. Please try again.';
      result.className = 'contact-result error';
    }
  } catch (err) {
    console.error('Failed to send contact message', err);
    result.textContent = 'Network error. Please try again.';
    result.className = 'contact-result error';
  }
}

// ---------- Privacy Policy ----------
function renderPrivacyPage() {
  const container = document.getElementById('mainContent');
  container.innerHTML =
    '<div class="legal-page">' +
      '<a href="/" class="back-link">← Back to safaris</a>' +
      '<h1>Privacy Policy</h1>' +
      '<p class="legal-updated">Last updated: September 22, 2026</p>' +
      '<h2>1. Introduction</h2>' +
      '<p>SavannahGo ("we", "our", or "the App") operates as a Pi Network application for discovering, booking, and paying for safaris across Africa. This Privacy Policy explains how we collect, use, and protect your information when you use our service.</p>' +
      '<h2>2. Information We Collect</h2>' +
      '<p>When you use SavannahGo, we may collect:</p>' +
      '<ul>' +
        '<li><strong>Pi Network identity:</strong> Your Pi username and unique user ID (UID), provided through the Pi SDK during authentication.</li>' +
        '<li><strong>Booking information:</strong> Safari selections, payment amounts, payment IDs, and blockchain transaction IDs.</li>' +
        '<li><strong>Contact information:</strong> If you submit a contact form, we collect the name, contact method, and message you provide.</li>' +
        '<li><strong>Review content:</strong> Star ratings and comments you submit about safaris.</li>' +
      '</ul>' +
      '<h2>3. How We Use Your Information</h2>' +
      '<p>We use collected information solely to authenticate you, process bookings and Pi payments, show your booking history and reviews, respond to inquiries, and improve the App.</p>' +
      '<h2>4. Information We Do NOT Collect</h2>' +
      '<ul>' +
        '<li>Your Pi Network passphrase or private key</li>' +
        '<li>Your wallet balance or private wallet addresses</li>' +
        '<li>Any passwords (authentication is handled entirely by the Pi SDK)</li>' +
        '<li>Your precise location or device identifiers</li>' +
      '</ul>' +
      '<h2>5. Data Storage</h2>' +
      '<p>Your data is stored securely using Turso (a cloud-hosted database). We retain your information for as long as your account is active or as needed to provide the service.</p>' +
      '<h2>6. Data Sharing</h2>' +
      '<p>We do not sell, rent, or share your personal information with third parties. Payment processing is handled entirely through the Pi Network blockchain and Platform APIs.</p>' +
      '<h2>7. Your Rights</h2>' +
      '<p>You may request deletion of your data by contacting us through the App\'s contact form. We will respond within a reasonable timeframe.</p>' +
      '<h2>8. Children\'s Privacy</h2>' +
      '<p>SavannahGo is not intended for users under the age required by Pi Network\'s terms of service. We do not knowingly collect information from children.</p>' +
      '<h2>9. Changes to This Policy</h2>' +
      '<p>We may update this Privacy Policy from time to time. Continued use of the App after changes constitutes acceptance of the updated policy.</p>' +
      '<h2>10. Contact Us</h2>' +
      '<p>For questions about this Privacy Policy, please use the <a href="/contact">Contact page</a>.</p>' +
    '</div>';
}

// ---------- Terms of Service ----------
function renderTermsPage() {
  const container = document.getElementById('mainContent');
  container.innerHTML =
    '<div class="legal-page">' +
      '<a href="/" class="back-link">← Back to safaris</a>' +
      '<h1>Terms of Service</h1>' +
      '<p class="legal-updated">Last updated: September 22, 2026</p>' +
      '<h2>1. Acceptance of Terms</h2>' +
      '<p>By using SavannahGo ("the App"), you agree to these Terms of Service. If you do not agree, please do not use the App.</p>' +
      '<h2>2. About SavannahGo</h2>' +
      '<p>SavannahGo is a Pi Network application that allows Pioneers to discover, book, and pay for safaris across Africa using Pi cryptocurrency.</p>' +
      '<h2>3. Eligibility</h2>' +
      '<p>You must have a valid Pi Network account and be of legal age in your jurisdiction to use this App.</p>' +
      '<h2>4. Payments</h2>' +
      '<p>All transactions are conducted exclusively in Pi (π). Payment amounts are displayed in Pi before you confirm any transaction. Once a payment is completed on the Pi blockchain, it is final and cannot be reversed.</p>' +
      '<h2>5. Bookings</h2>' +
      '<p>When you book a safari, you are expressing intent to purchase. Actual safari delivery is coordinated between you and the tour operator. SavannahGo acts as a marketplace and payment platform.</p>' +
      '<h2>6. Refunds</h2>' +
      '<p>Refunds are handled on a case-by-case basis according to the terms of each specific safari. Please review the "Terms &amp; conditions" section on each safari listing before booking.</p>' +
      '<h2>7. User Conduct</h2>' +
      '<ul>' +
        '<li>Submit false, misleading, or fraudulent information</li>' +
        '<li>Attempt to manipulate payments or pricing</li>' +
        '<li>Post abusive or inappropriate reviews</li>' +
        '<li>Use the App for any illegal purpose</li>' +
      '</ul>' +
      '<h2>8. Reviews</h2>' +
      '<p>Reviews may only be submitted by users who have completed a booking for the specific safari. We reserve the right to remove reviews that violate these terms.</p>' +
      '<h2>9. Limitation of Liability</h2>' +
      '<p>SavannahGo is provided "as is". We are not liable for issues arising from third-party tour operators, Pi Network outages, or blockchain-related delays.</p>' +
      '<h2>10. Intellectual Property</h2>' +
      '<p>All content, branding, and code of SavannahGo are protected. You may not copy or redistribute without permission.</p>' +
      '<h2>11. Changes to Terms</h2>' +
      '<p>We may modify these Terms at any time. Continued use of the App constitutes acceptance of any updates.</p>' +
      '<h2>12. Contact</h2>' +
      '<p>For questions, please use the <a href="/contact">Contact page</a>.</p>' +
    '</div>';
}

// ---------- Router ----------
function route() {
  const path = window.location.pathname;

  if (path === '/' || path === '/index.html') {
    renderListingsPage();
  } else if (path === '/contact') {
    renderContactPage();
  } else if (path === '/privacy') {
    renderPrivacyPage();
  } else if (path === '/terms') {
    renderTermsPage();
  } else if (path === '/admin') {
    renderAdminPage();
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