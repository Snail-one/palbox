'use strict';
const results = runPalboxTests(PalConfig, PalTemplate, PalSchema, PalStorage);
for (const result of results) {
  const item = document.createElement('li');
  item.textContent = `${result.ok ? '✓' : '✗'} ${result.name}${result.ok ? '' : '：' + result.error}`;
  item.style.color = result.ok ? '#525252' : '#bb4e47';
  item.style.marginBlock = '10px';
  document.getElementById('test-results').append(item);
}
document.getElementById('test-summary').textContent = `${results.filter(r => r.ok).length} / ${results.length} 项测试通过`;
