// mdBook's default tokenizer splits on whitespace; Chinese needs substring matching.
// Keep the built-in search UI, result links and English search behavior.
(() => {
  const original = elasticlunr.Index.prototype.search;
  elasticlunr.Index.prototype.search = function (query, options) {
    if (!/\p{Script=Han}/u.test(query)) return original.call(this, query, options);
    const terms = query.toLocaleLowerCase().trim().split(/\s+/u);
    return Object.entries(this.documentStore.docs)
      .filter(([, doc]) => terms.every(term => `${doc.title} ${doc.body}`.toLocaleLowerCase().includes(term)))
      .map(([ref, doc]) => ({ ref, doc, score: terms.reduce((score, term) => score + (doc.title.toLocaleLowerCase().includes(term) ? 2 : 1), 0) }))
      .sort((a, b) => b.score - a.score);
  };
})();
