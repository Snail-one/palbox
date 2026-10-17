export function createDom(document) {
  return {
    document,
    $: id => document.getElementById(id),
    el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    },
    empty: node => node.replaceChildren(),
    icon(name) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'icon');
      svg.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-' + name);
      svg.append(use);
      return svg;
    }
  };
}

export function savedTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '本地配置';
  return `更新于 ${date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}
