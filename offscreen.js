// Handle messages from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'readClipboard') {
    readClipboard().then(sendResponse);
    return true; // Indicates we will send a response asynchronously
  }
});

async function readClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    return { success: true, text: text };
  } catch (error) {
    console.error('Failed to read clipboard:', error);
    return { success: false, error: error.message };
  }
}
