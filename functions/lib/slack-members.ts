export const escapeSlack = (value: string) => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export function slackMemberLabel(directory: string | undefined, slug: string | null, name: string): string {
  try {
    const members = JSON.parse(directory ?? '{}');
    const member = slug && members && typeof members === 'object' ? members[slug] : undefined;
    if (typeof member === 'string' && /^[UW][A-Z0-9]{8,}$/.test(member)) return `<@${member}>`;
  } catch {
    // An unavailable or malformed directory falls back to the display name.
  }
  return escapeSlack(name);
}
