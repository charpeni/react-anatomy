// Two components that differ only in whether they read `caption`.
export function Ignored(_props: { caption: string }) {
  return <i>static</i>;
}

export function Reads({ caption }: { caption: string }) {
  return <b>{caption}</b>;
}
