export function normalizeText(value) {
  return String(value || '').replace(/\u0000/g, '').replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();
}

export function normalizeDocument({format, text, pages = [], metadata = {}}) {
  const normalizedPages = (pages.length ? pages : [text]).map((page, index) => ({
    number: index + 1, text: normalizeText(page)
  }));
  return {format, text: normalizeText(normalizedPages.map(p => p.text).join('\n')),
    pages: normalizedPages, metadata};
}
