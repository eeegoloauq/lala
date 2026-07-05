/** Reads the `deafened` flag from a participant's metadata JSON, defaulting to false on parse errors. */
export function readDeafened(metadata: string | undefined): boolean {
    try {
        return !!JSON.parse(metadata || '{}').deafened;
    } catch {
        return false;
    }
}
