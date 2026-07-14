// A canonical UUID. Route params like /campaigns/[id] arrive as arbitrary
// strings; querying Postgres with a non-UUID value raises 22P02 and surfaces as
// a 500. Guarding with this lets data loaders return null/empty so the page can
// render a clean 404 instead.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return !!value && UUID_RE.test(value);
}
