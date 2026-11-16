/**
 * Tags on a suggestion are edited as one comma-separated text field.
 * Trims each tag, collapses inner spaces, drops blanks and repeats (first wins).
 */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(",")) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/** The text field's starting value for a suggestion's saved tags. */
export function tagsToText(tags: string[] | null | undefined): string {
  return (tags ?? []).join(", ");
}
