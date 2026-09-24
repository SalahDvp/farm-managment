import { Fragment } from 'react'

// Joins short facts with " · ", isolating each one so mixed Latin/Arabic text
// ("24 ha" next to "6 عنصر") keeps its reading order in RTL.
export function MetaLine({ parts }: { parts: (string | false | null | undefined)[] }) {
  const shown = parts.filter((p): p is string => Boolean(p))
  return <>{shown.map((p, i) => <Fragment key={i}>{i > 0 && ' · '}<bdi>{p}</bdi></Fragment>)}</>
}
