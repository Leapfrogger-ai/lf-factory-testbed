// Node 26 ships Temporal at runtime, but neither @types/node nor TypeScript's lib
// declare it yet. Declare only what `deps.now` needs.
declare namespace Temporal {
  interface Instant {
    readonly epochMilliseconds: number;
    toString(): string;
  }
}
