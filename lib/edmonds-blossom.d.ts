declare module 'edmonds-blossom' {
  export default function blossom(
    edges: [number, number, number][],
    maxCardinality?: boolean,
  ): number[];
}
