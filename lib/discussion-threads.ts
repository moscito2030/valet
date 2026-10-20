/** Group replies under their parents while preserving sibling order. */
export function discussionThreads<T extends { id: string; replyTo?: string }>(comments: T[]) {
  const ids = new Set(comments.map(c => c.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const comment of comments) {
    if (comment.replyTo && ids.has(comment.replyTo) && comment.replyTo !== comment.id) {
      const siblings = children.get(comment.replyTo) ?? [];
      siblings.push(comment);
      children.set(comment.replyTo, siblings);
    } else roots.push(comment);
  }
  const result: { comment: T; depth: number }[] = [];
  const visited = new Set<string>();
  const visit = (comment: T, depth: number) => {
    if (visited.has(comment.id)) return;
    visited.add(comment.id);
    result.push({ comment, depth });
    for (const child of children.get(comment.id) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  // Retain malformed cyclic threads without looping or dropping comments.
  for (const comment of comments) visit(comment, 0);
  return result;
}
