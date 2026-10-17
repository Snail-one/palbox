export function createNotifications(dom) {
  let timer;
  const toast = dom.$('toast');
  const storage = dom.$('storage-error');
  return {
    toast(message, error = false) {
      clearTimeout(timer);
      toast.textContent = message;
      toast.classList.toggle('error', error);
      toast.hidden = false;
      timer = setTimeout(() => { toast.hidden = true; }, error ? 6500 : 3500);
    },
    storage(message) {
      storage.textContent = message;
      storage.hidden = !message;
    }
  };
}
