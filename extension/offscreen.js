chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'copy_to_clipboard') return;
  handleCopy(msg.dataUrl)
    .then(() => sendResponse({ ok: true }))
    .catch(e => sendResponse({ ok: false, error: e.message }));
  return true;
});

async function handleCopy(dataUrl) {
  const blob = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById('c');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = dataUrl;
  });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
