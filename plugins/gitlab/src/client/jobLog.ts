// A GitLab job log as steps. GitLab marks each section of a log with
// `section_start:<time>:<name>\r\e[0K<heading>` and `section_end:<time>:<name>\r\e[0K`, and colours
// the text with ANSI codes, which the kit's `Log` doesn't draw.

export type JobSection = { id: number; name: string; status: string | null; lines: string[] }

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g
const MARKER = /^section_(start|end):\d+:([^\r[]+)(?:\[[^\]]*\])?\r?(.*)$/

/** The log's sections in order. Text outside any section is a "Job log" section of its own. A job that
 *  didn't pass ends in its last section, which takes the job's status; the others passed. */
export function jobSections(text: string, status: string | null): JobSection[] {
  const sections: JobSection[] = []
  let open: JobSection | null = null
  let loose: JobSection | null = null
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(ANSI, '')
    const marker = MARKER.exec(line)
    if (marker?.[1] === 'start') {
      open = { id: sections.length, name: marker[3]?.trim() || marker[2]!.trim(), status: 'success', lines: [] }
      sections.push(open)
      loose = null
      continue
    }
    if (marker?.[1] === 'end') {
      open = null
      continue
    }
    if (open) open.lines.push(line)
    else {
      if (!loose) {
        loose = { id: sections.length, name: 'Job log', status: 'success', lines: [] }
        sections.push(loose)
      }
      loose.lines.push(line)
    }
  }
  const kept = sections.filter((section) => section.lines.some((line) => line.trim()) || section.name !== 'Job log')
  const last = kept.at(-1)
  if (last && status !== 'success') last.status = status
  return kept.map((section, id) => ({ ...section, id }))
}
