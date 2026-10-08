'use strict';
let releaseCopiedImage;
let imageCleanupTimer;

function clearCopiedImage() {
  clearTimeout(imageCleanupTimer);
  releaseCopiedImage?.();
  releaseCopiedImage = undefined;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'offscreen' || sender.id !== chrome.runtime.id) return;
  if (message.type === 'copy-image') {
    if (typeof message.dataUrl !== 'string' || !message.dataUrl.startsWith('data:image/png;base64,')) { respond({ ok: false }); return; }
    copyImage(message.dataUrl).then(ok => respond({ ok }), () => respond({ ok: false }));
    return true;
  }
  if (message.type !== 'copy-url' || typeof message.text !== 'string') return;
  clearCopiedImage();
  // Offscreen documents cannot be focused. Chrome's documented clipboard pattern
  // uses execCommand here because navigator.clipboard requires document focus.
  const field = document.getElementById('clipboard');
  let ok = false;
  try {
    field.value = message.text;
    field.select();
    ok = document.execCommand('copy');
  } catch { /* The caller surfaces clipboard failures. */ }
  finally { field.value = ''; field.blur(); }
  respond({ ok });
});

async function copyImage(dataUrl) {
  clearCopiedImage();
  let frame;
  let objectUrl;
  let timer;
  let copied = false;
  const release = () => { frame?.remove(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  try {
    const blob = await (await fetch(dataUrl)).blob();
    objectUrl = URL.createObjectURL(blob);
    frame = document.createElement('iframe');
    const loaded = new Promise((resolve, reject) => {
      frame.onload = resolve;
      frame.onerror = () => reject(new Error('Image load failed'));
      timer = setTimeout(() => reject(new Error('Image load timed out')), 5000);
    });
    frame.src = objectUrl;
    document.body.append(frame);
    await loaded;
    const imageDocument = frame.contentDocument;
    if (imageDocument?.contentType !== 'image/png' || !imageDocument.querySelector('img')?.naturalWidth) return false;
    frame.contentWindow.focus();
    imageDocument.getSelection().removeAllRanges();
    // Chromium's Copy command on an image document writes the actual bitmap.
    // A same-origin blob iframe lets it run here without stealing page focus.
    copied = imageDocument.execCommand('copy');
    if (copied) {
      // The browser commits bitmap writes asynchronously. Retain the source
      // frame until the next copy or idle cleanup, rather than racing its IPC.
      releaseCopiedImage = release;
      imageCleanupTimer = setTimeout(clearCopiedImage, 30000);
    }
    return copied;
  } finally {
    clearTimeout(timer);
    if (!copied) release();
  }
}
