document.querySelectorAll('.blog .code-block').forEach((block, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Copy';
  button.setAttribute('aria-label', `Copy code block ${index + 1}`);
  const status = document.createElement('span');
  status.className = 'copy-status';
  status.setAttribute('role', 'status');
  block.querySelector('figcaption').append(status, button);
  button.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(block.querySelector('code').textContent);
      status.textContent = 'Copied.';
    } catch {
      status.textContent = 'Could not copy. Select the code and copy it manually.';
    }
  });
});
