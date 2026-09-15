import { resolveCanonicalExecutable } from "./processNormalization.ts";

export const APP_LINK_KEY_PREFIX = "__app_link::";
export type AppLinks = Readonly<Record<string, string>>;

export function isLinkedIdentity(key: string, links: AppLinks): boolean {
  return Object.prototype.hasOwnProperty.call(links, key) || Object.values(links).includes(key);
}

export function validateAppLinks(links: AppLinks): void {
  const validIdentity = (key: string) => key.length > 0
    && new TextEncoder().encode(key).length + APP_LINK_KEY_PREFIX.length <= 256
    && ![...key].some((char) => char.codePointAt(0)! < 32 || (char.codePointAt(0)! >= 127 && char.codePointAt(0)! <= 159));
  for (const [member, parent] of Object.entries(links)) {
    if (!validIdentity(member) || !validIdentity(parent) || member !== resolveCanonicalExecutable(member)
      || parent !== resolveCanonicalExecutable(parent) || member === parent
      || Object.prototype.hasOwnProperty.call(links, parent)) {
      throw new Error("Invalid application association");
    }
  }
}

export function resolveLinkedApp(exeName: string, links: AppLinks): string {
  const key = resolveCanonicalExecutable(exeName);
  return Object.prototype.hasOwnProperty.call(links, key) ? links[key] : key;
}

export function linkedAppKeys(parent: string, links: AppLinks): string[] {
  return [parent, ...Object.keys(links).filter((key) => links[key] === parent)];
}

export function changeAppLink(links: AppLinks, member: string, parent: string | null): AppLinks {
  const next = { ...links };
  if (parent === null) delete next[member];
  else next[member] = parent;
  validateAppLinks(next);
  return next;
}
