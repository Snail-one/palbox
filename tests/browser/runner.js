import { coreCases } from '../shared/core-cases.js';

const results = coreCases().map(({ name, run }) => {
  try { run(); return { name, ok: true }; }
  catch (error) { return { name, ok: false, error: error.message }; }
});
for (const result of results) {
  const item = document.createElement('li');
  item.textContent = `${result.ok ? '✓' : '✗'} ${result.name}${result.ok ? '' : '：' + result.error}`;
  item.style.marginBlock = '10px';
  document.getElementById('test-results').append(item);
}
document.getElementById('test-summary').textContent = `${results.filter(r => r.ok).length} / ${results.length} 项测试通过`;
