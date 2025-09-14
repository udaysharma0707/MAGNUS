// app.js - improved mobile-friendly client with JSONP queue & background send
// IMPORTANT: set ENDPOINT to your Apps Script web app URL and SHARED_TOKEN to the secret above
const ENDPOINT = "https://script.google.com/macros/s/AKfycbyAGZaHB7o7POi86Obu99fdxDrTTHxFyF0qhz0c5CPTPRSt8cMMz1qffp9tlCwmz5IpVQ/exec";
const SHARED_TOKEN = "shopSecret2025";
const KEY_QUEUE = "car_entry_queue_v1";

// ---------- helpers ----------
function updateStatus() {
  const s = document.getElementById('status');
  if (s) s.textContent = navigator.onLine ? 'online' : 'offline';
  console.log('[STATUS]', navigator.onLine ? 'online' : 'offline');
}
window.addEventListener('online', ()=>{ updateStatus(); flushQueue(); });
window.addEventListener('offline', ()=>{ updateStatus(); });

// queue helpers
function getQueue(){ try { return JSON.parse(localStorage.getItem(KEY_QUEUE) || "[]"); } catch(e){ console.warn('queue parse err', e); return []; } }
function setQueue(q){ localStorage.setItem(KEY_QUEUE, JSON.stringify(q)); }

// Uppercase except services (do not touch services array)
function uppercaseExceptServices(fd) {
  try {
    fd.carRegistrationNo = (fd.carRegistrationNo || "").toString().toUpperCase();
    fd.carName = (fd.carName || "").toString().toUpperCase();
    if (Array.isArray(fd.modeOfPayment)) fd.modeOfPayment = fd.modeOfPayment.map(s => (s||"").toString().toUpperCase());
    else fd.modeOfPayment = (fd.modeOfPayment || "").toString().toUpperCase();
    fd.adviceToCustomer = (fd.adviceToCustomer || "").toString().toUpperCase();
    fd.otherInfo = (fd.otherInfo || "").toString().toUpperCase();
  } catch(e){ console.warn('uppercaseExceptServices err', e); }
  return fd;
}

// Format car registration: try to produce "AA NNXXX NNNN" style (state + RTO+letters + last4)
function formatCarRegistration(raw) {
  if (!raw) return raw;
  var s = raw.toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
  // try main regex: 1-2 letters, 1-2 digits, 0-6 letters/digits, 4 digits
  var re = /^([A-Z]{1,2})(\d{1,2})([A-Z0-9]{0,6})(\d{4})$/;
  var m = s.match(re);
  if (m) {
    var part1 = m[1];
    var part2 = m[2] + (m[3] || "");
    var part3 = m[4];
    return part1 + " " + part2 + " " + part3;
  }
  // fallback: if ends with 4 digits, split them and put space before last4
  var last4 = s.match(/(\d{4})$/);
  if (last4) {
    var last4Digits = last4[1];
    var rest = s.slice(0, s.length - 4);
    if (rest.length >= 2) {
      var st = rest.slice(0, 2);
      var mid = rest.slice(2);
      if (mid.length > 0) return st + " " + mid + " " + last4Digits;
      return st + " " + last4Digits;
    } else if (rest.length > 0) {
      return rest + " " + last4Digits;
    }
  }
  return s;
}

// JSONP helper (improved error logging + longer timeout)
function jsonpRequest(url, timeoutMs) {
  timeoutMs = timeoutMs || 25000; // increased timeout for slow mobile networks
  return new Promise(function(resolve, reject) {
    var cbName = "jsonp_cb_" + Date.now() + "_" + Math.floor(Math.random()*1000000);
    var called = false;
    window[cbName] = function(data) {
      called = true;
      try { resolve(data); } finally {
        try { delete window[cbName]; } catch(e){}
        var s = document.getElementById(cbName);
        if (s && s.parentNode) s.parentNode.removeChild(s);
      }
    };
    // ensure callback param not present already
    url = url.replace(/(&|\?)?callback=[^&]*/i, "");
    var full = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + encodeURIComponent(cbName);
    var script = document.createElement('script');
    script.id = cbName;
    script.src = full;
    script.async = true;

    script.onerror = function(ev) {
      try { delete window[cbName]; } catch(e){}
      if (script.parentNode) script.parentNode.removeChild(script);
      var err = new Error('JSONP script load error');
      err.detail = ev || null;
      reject(err);
    };

    var timer = setTimeout(function(){
      try { delete window[cbName]; } catch(e){}
      if (script.parentNode) script.parentNode.removeChild(script);
      reject(new Error('JSONP timeout'));
    }, timeoutMs);

    // On successful load but no callback invoked (server returned HTML or login page),
    // we wait a short grace period then fail clearly.
    script.onload = function() {
      // if callback hasn't been invoked within 1200ms after load, assume invalid response
      setTimeout(function(){
        if (!called) {
          try { delete window[cbName]; } catch(e){}
          if (script.parentNode) script.parentNode.removeChild(script);
          reject(new Error('JSONP loaded but callback never called — server may be returning HTML or a login page (check web app permissions).'));
        }
      }, 1200);
    };

    document.body.appendChild(script);
  });
}

// Build JSONP URL and call
function sendToServerJSONP(formData, clientTs) {
  var params = [];
  function add(k,v){ if (v === undefined || v === null) v=""; params.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v))); }
  add("token", SHARED_TOKEN);
  add("carRegistrationNo", formData.carRegistrationNo || "");
  add("carName", formData.carName || "");
  if (Array.isArray(formData.services)) add("services", formData.services.join(", "));
  else add("services", formData.services || "");
  add("qtyTiresWheelCoverSold", formData.qtyTiresWheelCoverSold || "");
  add("amountPaid", formData.amountPaid || "");
  if (Array.isArray(formData.modeOfPayment)) add("modeOfPayment", formData.modeOfPayment.join(", "));
  else add("modeOfPayment", formData.modeOfPayment || "");
  add("kmsTravelled", formData.kmsTravelled || "");
  add("adviceToCustomer", formData.adviceToCustomer || "");
  add("otherInfo", formData.otherInfo || "");
  if (clientTs) add("clientTs", String(clientTs));

  var base = ENDPOINT;
  var url = base + (base.indexOf('?') === -1 ? '?' : '&') + params.join("&");
  if (url.length > 1900) return Promise.reject(new Error("Payload too large for JSONP"));
  return jsonpRequest(url, 20000);
}

function queueSubmission(formData){
  var q = getQueue(); q.push({ ts: Date.now(), data: formData }); setQueue(q);
  console.log('[QUEUE] queued, length=', getQueue().length);
}

// flushQueue: sequentially send oldest-first
async function flushQueue() {
  if (!navigator.onLine) return;
  var q = getQueue();
  if (!q || q.length === 0) { console.log('[FLUSH] queue empty'); return; }
  console.log('[FLUSH] starting, len=', q.length);
  var submitBtnEl = document.getElementById('submitBtn');
  if (submitBtnEl) submitBtnEl.disabled = true;
  while (q.length > 0 && navigator.onLine) {
    var item = q[0];
    try {
      var resp = await sendToServerJSONP(item.data, item.ts);
      console.log('[FLUSH] resp', resp);
      if (resp && resp.success) { q.shift(); setQueue(q); await new Promise(r=>setTimeout(r,120)); }
      else {
        if (resp && resp.error) { alert("Server error during flush: " + resp.error); break; }
        break;
      }
    } catch (err) {
      console.warn('[FLUSH] error', err);
      break;
    }
    q = getQueue();
  }
  if (submitBtnEl) submitBtnEl.disabled = false;
  console.log('[FLUSH] finished, remaining=', getQueue().length);
}

// collect data from DOM
function collectFormData(){
  var services = Array.from(document.querySelectorAll('.service:checked')).map(i=>i.value);
  var mode = Array.from(document.querySelectorAll('.mode:checked')).map(i=>i.value);
  return {
    carRegistrationNo: document.getElementById('carRegistrationNo').value.trim(),
    carName: document.getElementById('carName').value.trim(),
    services: services,
    qtyTiresWheelCoverSold: document.getElementById('qtyTiresWheelCoverSold').value,
    amountPaid: document.getElementById('amountPaid').value,
    modeOfPayment: mode,
    kmsTravelled: document.getElementById('kmsTravelled').value,
    adviceToCustomer: document.getElementById('adviceToCustomer').value.trim(),
    otherInfo: document.getElementById('otherInfo').value.trim(),
    addIfMissing: document.getElementById('addIfMissing') ? document.getElementById('addIfMissing').checked : false
  };
}

function showMessage(text){
  var m = document.getElementById('msg');
  if (!m) { console.log('[UI]', text); return; }
  m.textContent = text; m.style.display='block';
  setTimeout(()=>{ if (m) m.style.display='none'; }, 4000);
}
function clearForm(){
  try {
    document.getElementById('carRegistrationNo').value='';
    document.getElementById('carName').value='';
    document.querySelectorAll('.service').forEach(ch=>ch.checked=false);
    document.getElementById('qtyTiresWheelCoverSold').value='';
    document.getElementById('amountPaid').value='';
    document.querySelectorAll('.mode').forEach(ch=>ch.checked=false);
    document.getElementById('kmsTravelled').value='';
    document.getElementById('adviceToCustomer').value='';
    document.getElementById('otherInfo').value='';
    if (document.getElementById('addIfMissing')) document.getElementById('addIfMissing').checked=false;
  } catch(e){ console.warn('clearForm error', e); }
}

// ---------- DOM bindings (safe for mobile) ----------
document.addEventListener('DOMContentLoaded', function() {
  updateStatus();

  // --- New: attempt to remove any old service workers & clear caches so mobile gets latest files ---
  (async function unregisterSWandClearCaches() {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          try { await r.unregister(); console.log('unregistered SW'); } catch(e){}
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const k of keys) {
          try { await caches.delete(k); console.log('deleted cache', k); } catch(e){}
        }
      }
      // small delay to allow browser to release caches
      await new Promise(r=>setTimeout(r, 200));
    } catch(e) {
      console.warn('SW/cache cleanup failed', e);
    }
  })();

  const submitBtn = document.getElementById('submitBtn');
  const clearBtn = document.getElementById('clearBtn');

  if (!submitBtn) {
    console.warn('[INIT] submitBtn not found in DOM');
    return;
  }

  // Ensure button is type=button
  try { submitBtn.setAttribute('type','button'); } catch(e){}

  // Prevent double-handling between touchend and click
  let ignoreNextClick = false;

  async function doSubmitFlow() {
    try {
      // Basic client validation
      var carReg = document.getElementById('carRegistrationNo').value.trim();
      var servicesChecked = document.querySelectorAll('.service:checked');
      var amount = document.getElementById('amountPaid').value.trim();
      var modeChecked = document.querySelectorAll('.mode:checked');

      if (carReg === "") { alert("Car registration number is required."); return; }
      if (!servicesChecked || servicesChecked.length === 0) { alert("Please select at least one service."); return; }
      if (amount === "") { alert("Amount paid by customer is required."); return; }
      if (!modeChecked || modeChecked.length === 0) { alert("Please select at least one mode of payment."); return; }

      // collect
      var formData = collectFormData();
      // format car registration (client-side)
      formData.carRegistrationNo = formatCarRegistration(formData.carRegistrationNo);
      // uppercase except services
      formData = uppercaseExceptServices(formData);

      // immediate visible feedback but short-lived
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';
      setTimeout(()=>{ submitBtn.textContent = 'Submit'; submitBtn.disabled = false; }, 700);

      // clear UI immediately (user asked for this)
      showMessage('Submitted — registering...');
      clearForm();

      // background send
      (async function backgroundSend() {
        try {
          if (navigator.onLine) {
            // flush queued first
            try { await flushQueue(); } catch(e){ console.warn('flushQueue err', e); }
            // send current
            try {
              const clientTs = Date.now();
              const resp = await sendToServerJSONP(formData, clientTs);
              if (resp && resp.success) {
                showMessage('Saved — Serial: ' + resp.serial);
              } else if (resp && resp.error) {
                // server validation error -> show message but do NOT queue
                showMessage('Server rejected: ' + resp.error);
                console.warn('Server rejected:', resp.error);
              } else {
                // unknown -> queue
                queueSubmission(formData);
                showMessage('Saved locally (server busy). Will sync later.');
              }
            } catch (errSend) {
              console.warn('send failed -> queueing', errSend);
              // helpful diagnostic: if JSONP script failed with message about "callback never called"
              if (errSend && errSend.message && errSend.message.indexOf('callback never called') !== -1) {
                showMessage('Network/server problem — check web app deployment & permissions. Changes saved locally.');
                console.error('JSONP callback not invoked — likely web app not accessible (needs "Anyone, even anonymous" access or correct ENDPOINT).');
              } else {
                showMessage('Network error — saved locally.');
              }
              queueSubmission(formData);
            }
            // try flush again
            try { await flushQueue(); } catch(e){}
          } else {
            queueSubmission(formData);
            showMessage('Offline — saved locally and will sync when online.');
          }
        } catch (bgErr) {
          console.error('backgroundSend unexpected', bgErr);
          try { queueSubmission(formData); } catch(e){}
          showMessage('Error occurred — saved locally.');
        }
      })();

    } catch (ex) {
      console.error('submit handler exception', ex);
      showMessage('Unexpected error. Try again.');
      submitBtn.disabled = false; submitBtn.textContent = 'Submit';
    }
  }

  // touchend handler to support mobile taps
  function onTouchEndSubmit(ev) {
    if (!ev) return;
    ev.preventDefault && ev.preventDefault();
    ev.stopPropagation && ev.stopPropagation();
    ignoreNextClick = true;
    setTimeout(()=>{ ignoreNextClick = false; }, 800);
    doSubmitFlow();
  }
  function onClickSubmit(ev) {
    if (ignoreNextClick) { ev && ev.preventDefault(); console.log('[APP] ignored click after touch'); return; }
    doSubmitFlow();
  }

  // Attach event listeners (touch first, then click)
  submitBtn.addEventListener('touchend', onTouchEndSubmit, { passive:false });
  submitBtn.addEventListener('click', onClickSubmit, { passive:false });

  // Clear button
  if (clearBtn) {
    clearBtn.addEventListener('touchend', function(ev){ ev && ev.preventDefault(); clearForm(); showMessage('Form cleared'); }, { passive:false });
    clearBtn.addEventListener('click', function(ev){ clearForm(); showMessage('Form cleared'); }, { passive:false });
  }

  // quick overlay check (helpful when mobile layouts accidentally cover button)
  setTimeout(function(){
    try {
      var rect = submitBtn.getBoundingClientRect();
      var midX = rect.left + rect.width/2;
      var midY = rect.top + rect.height/2;
      var el = document.elementFromPoint(midX, midY);
      if (el && el !== submitBtn && !submitBtn.contains(el)) {
        console.warn('[APP] submit button may be overlapped by', el);
      } else {
        console.log('[APP] submit button reachable');
      }
    } catch(e){}
  }, 300);

}); // DOMContentLoaded end

