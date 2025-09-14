// app.js - improved mobile-friendly client with detailed mobile diagnostics + JSONP queue & background send
// IMPORTANT: set ENDPOINT to your Apps Script web app URL and SHARED_TOKEN to the secret above
const ENDPOINT = "https://script.google.com/macros/s/AKfycbyAGZaHB7o7POi86Obu99fdxDrTTHxFyF0qhz0c5CPTPRSt8cMMz1qffp9tlCwmz5IpVQ/exec";
const SHARED_TOKEN = "shopSecret2025";
const KEY_QUEUE = "car_entry_queue_v1";
const KEY_LAST_ERROR = "car_entry_last_error_v1";

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
function setLastError(msg) {
  try { localStorage.setItem(KEY_LAST_ERROR, String(msg || "")); } catch(e){}
  const dbg = document.getElementById('debugError');
  if (dbg) dbg.textContent = msg || "";
  console.log('[LAST_ERROR]', msg);
}
function getLastError() { try { return localStorage.getItem(KEY_LAST_ERROR) || ""; } catch(e){ return ""; } }

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

// Format car registration: same helper you used before
function formatCarRegistration(raw) {
  if (!raw) return raw;
  var s = raw.toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
  var re = /^([A-Z]{1,2})(\d{1,2})([A-Z0-9]{0,6})(\d{4})$/;
  var m = s.match(re);
  if (m) {
    var part1 = m[1];
    var part2 = m[2] + (m[3] || "");
    var part3 = m[4];
    return part1 + " " + part2 + " " + part3;
  }
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

// JSONP helper (more diagnostics)
function jsonpRequest(url, timeoutMs) {
  timeoutMs = timeoutMs || 25000; // mobile networks sometimes slow
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

    // ensure we don't accidentally leave a trailing callback param
    url = url.replace(/(&|\?)?callback=[^&]*/i, "");
    var full = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + encodeURIComponent(cbName);

    // Safety: if URL too long, fail early with a clear message
    if (full.length > 1900) {
      var emsg = "Payload too large for JSONP (url length " + full.length + ").";
      reject(new Error(emsg));
      setLastError(emsg);
      return;
    }

    var script = document.createElement('script');
    script.id = cbName;
    script.src = full;
    script.async = true;

    script.onerror = function(ev) {
      try { delete window[cbName]; } catch(e){}
      if (script.parentNode) script.parentNode.removeChild(script);
      var err = new Error('JSONP script load error');
      err.detail = ev || null;
      setLastError(err.message + (ev ? " (onerror event)" : ""));
      reject(err);
    };

    // If script loads but the callback never runs (server returned HTML or login page),
    // we detect that and reject with a clear message.
    var loadTimer = null;
    script.onload = function() {
      // set grace period to allow callback to run
      loadTimer = setTimeout(function(){
        if (!called) {
          try { delete window[cbName]; } catch(e){}
          if (script.parentNode) script.parentNode.removeChild(script);
          var em = 'JSONP loaded but callback never called — server may be returning HTML (login page) or invalid response.';
          setLastError(em + " URL: " + full);
          reject(new Error(em));
        }
      }, 1200);
    };

    var timer = setTimeout(function(){
      try { delete window[cbName]; } catch(e){}
      if (script.parentNode) script.parentNode.removeChild(script);
      var em = 'JSONP timeout after ' + timeoutMs + 'ms';
      setLastError(em + " URL len=" + full.length);
      reject(new Error(em));
    }, timeoutMs);

    // cleanup on success path will clear these timers inside callback
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
  if (url.length > 1900) {
    // explicit rejection here so caller can show a useful message
    var em = "Payload too large for JSONP (url length " + url.length + "). Try shortening fields.";
    setLastError(em);
    return Promise.reject(new Error(em));
  }
  return jsonpRequest(url, 25000);
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
        if (resp && resp.error) { alert("Server error during flush: " + resp.error); setLastError("Server error during flush: " + resp.error); break; }
        break;
      }
    } catch (err) {
      console.warn('[FLUSH] error', err);
      setLastError('[FLUSH] ' + (err && err.message ? err.message : String(err)));
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

  // show last error if any (small debug area)
  (function showExistingError(){
    var dbg = document.getElementById('debugError');
    if (!dbg) {
      dbg = document.createElement('div');
      dbg.id = 'debugError';
      dbg.style.position = 'fixed';
      dbg.style.left = '8px';
      dbg.style.bottom = '8px';
      dbg.style.right = '8px';
      dbg.style.background = 'rgba(255,230,200,0.95)';
      dbg.style.color = '#000';
      dbg.style.padding = '8px';
      dbg.style.fontSize = '12px';
      dbg.style.border = '1px solid #e0b45c';
      dbg.style.borderRadius = '6px';
      dbg.style.zIndex = 9999;
      dbg.style.maxHeight = '120px';
      dbg.style.overflow = 'auto';
      dbg.title = 'Last network error (tap to clear)';
      dbg.addEventListener('click', function(){ setLastError(''); dbg.textContent = ''; });
      document.body.appendChild(dbg);
    }
    dbg.textContent = getLastError();
  })();

  // --- Attempt to unregister SW & clear caches (best-effort) ---
  (async function unregisterSWandClearCaches() {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) { try { await r.unregister(); } catch(e){} }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const k of keys) { try { await caches.delete(k); } catch(e){} }
      }
      await new Promise(r=>setTimeout(r, 200));
    } catch(e) { console.warn('SW/cache cleanup failed', e); }
  })();

  const submitBtn = document.getElementById('submitBtn');
  const clearBtn = document.getElementById('clearBtn');

  if (!submitBtn) {
    console.warn('[INIT] submitBtn not found in DOM');
    return;
  }

  try { submitBtn.setAttribute('type','button'); } catch(e){}

  let ignoreNextClick = false;

  async function doSubmitFlow() {
    try {
      var carReg = document.getElementById('carRegistrationNo').value.trim();
      var servicesChecked = document.querySelectorAll('.service:checked');
      var amount = document.getElementById('amountPaid').value.trim();
      var modeChecked = document.querySelectorAll('.mode:checked');

      if (carReg === "") { alert("Car registration number is required."); return; }
      if (!servicesChecked || servicesChecked.length === 0) { alert("Please select at least one service."); return; }
      if (amount === "") { alert("Amount paid by customer is required."); return; }
      if (!modeChecked || modeChecked.length === 0) { alert("Please select at least one mode of payment."); return; }

      var formData = collectFormData();
      formData.carRegistrationNo = formatCarRegistration(formData.carRegistrationNo);
      formData = uppercaseExceptServices(formData);

      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';
      setTimeout(()=>{ submitBtn.textContent = 'Submit'; submitBtn.disabled = false; }, 700);

      showMessage('Submitted — registering...');
      clearForm();

      (async function backgroundSend() {
        try {
          if (navigator.onLine) {
            try { await flushQueue(); } catch(e){ console.warn('flushQueue err', e); }
            try {
              const clientTs = Date.now();
              const resp = await sendToServerJSONP(formData, clientTs);
              if (resp && resp.success) {
                showMessage('Saved — Serial: ' + resp.serial);
                setLastError(''); // clear last error on success
              } else if (resp && resp.error) {
                showMessage('Server rejected: ' + resp.error);
                setLastError('Server rejected: ' + resp.error);
                console.warn('Server rejected:', resp.error);
              } else {
                queueSubmission(formData);
                showMessage('Saved locally (server busy). Will sync later.');
                setLastError('Unknown server response during submission');
              }
            } catch (errSend) {
              // show a detailed message to the user and save to debug box
              var emsg = (errSend && errSend.message) ? errSend.message : String(errSend);
              console.warn('send failed -> queueing', errSend);
              setLastError('send failed: ' + emsg);
              // If our code detected payload-too-large, show that explicitly
              if (emsg && emsg.indexOf('Payload too large') !== -1) {
                showMessage('Payload too large for JSONP — saved locally. Try shorter text.');
              } else if (emsg && emsg.indexOf('callback never called') !== -1) {
                showMessage('Server returned non-JSONP (possibly login page). Check web app deployment. Saved locally.');
              } else if (emsg && emsg.indexOf('JSONP timeout') !== -1) {
                showMessage('Network timeout — saved locally.');
              } else {
                showMessage('Network error — saved locally.');
              }
              queueSubmission(formData);
            }
            try { await flushQueue(); } catch(e){}
          } else {
            queueSubmission(formData);
            showMessage('Offline — saved locally and will sync when online.');
            setLastError('Offline at submit time');
          }
        } catch (bgErr) {
          console.error('backgroundSend unexpected', bgErr);
          try { queueSubmission(formData); } catch(e){}
          showMessage('Error occurred — saved locally.');
          setLastError('backgroundSend unexpected: ' + (bgErr && bgErr.message ? bgErr.message : String(bgErr)));
        }
      })();

    } catch (ex) {
      console.error('submit handler exception', ex);
      showMessage('Unexpected error. Try again.');
      submitBtn.disabled = false; submitBtn.textContent = 'Submit';
      setLastError('submit handler exception: ' + (ex && ex.message ? ex.message : String(ex)));
    }
  }

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

  submitBtn.addEventListener('touchend', onTouchEndSubmit, { passive:false });
  submitBtn.addEventListener('click', onClickSubmit, { passive:false });

  if (clearBtn) {
    clearBtn.addEventListener('touchend', function(ev){ ev && ev.preventDefault(); clearForm(); showMessage('Form cleared'); }, { passive:false });
    clearBtn.addEventListener('click', function(ev){ clearForm(); showMessage('Form cleared'); }, { passive:false });
  }

  // quick overlay check
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
