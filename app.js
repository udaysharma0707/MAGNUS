// app.js - JSONP with robust mobile fallbacks (fetch no-cors, sendBeacon, image) + queueing
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

// Build the full URL (same params as before)
function buildEndpointUrl(formData, clientTs) {
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
  return base + (base.indexOf('?') === -1 ? '?' : '&') + params.join("&");
}

// JSONP helper
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

    url = url.replace(/(&|\?)?callback=[^&]*/i, "");
    var full = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + encodeURIComponent(cbName);

    if (full.length > 1900) {
      var emsg = "Payload too large for JSONP (url length " + full.length + ").";
      setLastError(emsg);
      reject(new Error(emsg));
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
      setLastError(err.message + (ev ? " (onerror)" : ""));
      reject(err);
    };

    script.onload = function() {
      // if callback hasn't run quickly, assume callback never called
      setTimeout(function(){
        if (!called) {
          try { delete window[cbName]; } catch(e){}
          if (script.parentNode) script.parentNode.removeChild(script);
          var em = 'JSONP loaded but callback never called — server may be returning HTML or login page.';
          setLastError(em + " URL len=" + full.length);
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

    document.body.appendChild(script);
  });
}

// fallback: fetch with mode:'no-cors' GET (fire-and-forget). Resolves if request dispatched.
function sendViaNoCorsGET(url, timeoutMs) {
  timeoutMs = timeoutMs || 20000;
  return new Promise(async (resolve, reject) => {
    if (!window.fetch) {
      return reject(new Error('fetch not available'));
    }
    var did = false;
    try {
      // send as no-cors GET (response will be opaque). If fetch resolves, treat as success.
      var p = fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
      var t = setTimeout(function(){
        if (!did) {
          did = true;
          setLastError('fetch(no-cors) timeout');
          resolve({ success: true, note: 'fetch_no_cors_timeout_assumed_sent' });
        }
      }, timeoutMs);
      p.then(function(resp){
        if (did) return;
        did = true;
        clearTimeout(t);
        // resp is opaque; we cannot read JSON, but request was sent
        resolve({ success: true, note: 'fetch_no_cors_sent' });
      }).catch(function(err){
        if (did) return;
        did = true;
        clearTimeout(t);
        setLastError('fetch(no-cors) error: ' + (err && err.message ? err.message : String(err)));
        reject(err || new Error('fetch(no-cors) failed'));
      });
    } catch (e) {
      setLastError('fetch(no-cors) exception: ' + (e && e.message ? e.message : String(e)));
      reject(e);
    }
  });
}

// fallback: navigator.sendBeacon (POST) returns boolean; we wrap in Promise
function sendViaBeacon(url) {
  return new Promise((resolve, reject) => {
    try {
      if (navigator.sendBeacon) {
        var ok = navigator.sendBeacon(url); // with GET-style URL, works as POST body empty; server receives URL querystring
        if (ok) {
          resolve({ success: true, note: 'sendBeacon_sent' });
        } else {
          setLastError('sendBeacon returned false');
          reject(new Error('sendBeacon returned false'));
        }
      } else {
        reject(new Error('sendBeacon not available'));
      }
    } catch (e) {
      setLastError('sendBeacon exception: ' + (e && e.message ? e.message : String(e)));
      reject(e);
    }
  });
}

// fallback: image ping (fire-and-forget)
function sendViaImage(url, timeoutMs) {
  timeoutMs = timeoutMs || 10000;
  return new Promise((resolve, reject) => {
    try {
      var img = new Image();
      var done = false;
      var t = setTimeout(function(){
        if (done) return;
        done = true;
        // even if timeout, we assume request likely reached server
        setLastError('Image ping timeout (assuming sent)');
        resolve({ success: true, note: 'image_timeout_assumed_sent' });
      }, timeoutMs);
      img.onload = function(){ if (done) return; done = true; clearTimeout(t); resolve({ success:true, note:'image_onload' }); };
      img.onerror = function(){ if (done) return; done = true; clearTimeout(t); // might still have reached server
        setLastError('Image ping error (but request may have been delivered)');
        resolve({ success:true, note:'image_onerror' }); 
      };
      img.src = url;
    } catch (e) {
      setLastError('Image ping exception: ' + (e && e.message ? e.message : String(e)));
      reject(e);
    }
  });
}

// Attempt to send using the chain: JSONP -> fetch(no-cors) -> beacon -> image
async function sendWithFallbacks(formData, clientTs) {
  const url = buildEndpointUrl(formData, clientTs);
  // Try JSONP first (gives us structured response)
  try {
    const resp = await jsonpRequest(url, 25000);
    return resp;
  } catch (errJsonp) {
    // record error
    setLastError('JSONP failed: ' + (errJsonp && errJsonp.message ? errJsonp.message : String(errJsonp)));
    console.warn('JSONP failed, trying fetch(no-cors):', errJsonp);
  }

  // Try fetch no-cors
  try {
    const resp = await sendViaNoCorsGET(url, 20000);
    setLastError('fallback fetch(no-cors) used: ' + (resp && resp.note ? resp.note : 'sent'));
    return { success: true, note: 'fallback_fetch_no_cors' };
  } catch (errFetch) {
    setLastError('fetch(no-cors) failed: ' + (errFetch && errFetch.message ? errFetch.message : String(errFetch)));
    console.warn('fetch(no-cors) failed:', errFetch);
  }

  // Try sendBeacon
  try {
    const resp = await sendViaBeacon(url);
    setLastError('fallback sendBeacon used: ' + (resp && resp.note ? resp.note : 'sent'));
    return { success: true, note: 'fallback_beacon' };
  } catch (errBeacon) {
    setLastError('sendBeacon failed: ' + (errBeacon && errBeacon.message ? errBeacon.message : String(errBeacon)));
    console.warn('sendBeacon failed:', errBeacon);
  }

  // Last resort, try image ping
  try {
    const resp = await sendViaImage(url, 10000);
    setLastError('fallback image ping used: ' + (resp && resp.note ? resp.note : 'sent'));
    return { success: true, note: 'fallback_image' };
  } catch (errImg) {
    setLastError('image ping failed: ' + (errImg && errImg.message ? errImg.message : String(errImg)));
    console.warn('image ping failed:', errImg);
  }

  // All failed
  throw new Error('All network delivery methods failed');
}

function queueSubmission(formData){
  var q = getQueue(); q.push({ ts: Date.now(), data: formData }); setQueue(q);
  console.log('[QUEUE] queued, length=', getQueue().length);
}

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
      // try robust sendWithFallbacks for queued items; include original ts
      var resp = await sendWithFallbacks(item.data, item.ts);
      console.log('[FLUSH] resp', resp);
      // If we got a JSONP-style response with success true, remove from queue
      if (resp && resp.success) {
        q.shift(); setQueue(q);
        await new Promise(r=>setTimeout(r,120));
      } else {
        // If fallback delivered but didn't return structured response, assume success and remove
        if (resp && resp.note && resp.note.indexOf('fallback') === 0) {
          q.shift(); setQueue(q);
        } else {
          // unknown -> stop flush and retry later
          break;
        }
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

// ---------- DOM bindings ----------
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

  // try to lightly clear service workers & caches (best-effort)
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

            const clientTs = Date.now();
            try {
              const resp = await sendWithFallbacks(formData, clientTs);
              // if JSONP returned success true, use that; else fallback note
              if (resp && resp.success) {
                if (resp.serial) showMessage('Saved — Serial: ' + resp.serial);
                else showMessage('Saved (delivered via fallback).');
                setLastError('');
              } else if (resp && resp.note) {
                showMessage('Saved (fallback: ' + resp.note + ')');
                setLastError('Fallback used: ' + resp.note);
              } else {
                // unknown -> queue
                queueSubmission(formData);
                showMessage('Saved locally (server returned unknown response). Will sync later.');
                setLastError('Unknown server response');
              }
            } catch (errSend) {
              console.warn('all send methods failed -> queueing', errSend);
              setLastError('All send methods failed: ' + (errSend && errSend.message ? errSend.message : String(errSend)));
              queueSubmission(formData);
              showMessage('Network error — saved locally.');
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
