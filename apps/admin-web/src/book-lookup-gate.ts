/** A monotonically increasing token for ISBN lookup replies.
 * Any manual edit, newer request or unmount invalidates older responses.
 */
export function createBookLookupGate() {
  let revision = 0;
  return {
    start: () => ++revision,
    invalidate: () => { revision += 1; },
    current: (token: number) => token === revision,
  };
}
