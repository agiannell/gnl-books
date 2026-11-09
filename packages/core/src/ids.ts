// An id comes from a client. Postgres raises on text that is not a uuid, which
// would read as a server error rather than "no such profile".
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);
