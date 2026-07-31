export type FileSearchEntry = {
  name: string
  isDirectory: boolean
  path: string
}

export type FileSearchMode = 'all' | 'files' | 'folders'

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.gradle',
  '.idea',
  'node_modules',
  'build',
  'out',
  'dist',
  'target',
  'generated',
  'coverage',
  '.next',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
])

const splitCamelCase = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1 $2')

export function tokenizeSearch(value: string): string[] {
  return splitCamelCase(value)
    .toLowerCase()
    .replace(/[\\/]+/g, '/')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

const normalizedPath = (value: string) => tokenizeSearch(value).join('/')
const pathTokens = (value: string) => tokenizeSearch(value)

function isExcluded(entry: FileSearchEntry): boolean {
  const parts = entry.path.replace(/\\/g, '/').split('/')
  const directoryParts = entry.isDirectory ? parts : parts.slice(0, -1)
  return directoryParts.some((part) => EXCLUDED_DIRECTORIES.has(part.toLowerCase()))
}

function fuzzyScore(tokens: string[], queryTokens: string[]): number {
  let score = 0
  for (const queryToken of queryTokens) {
    const match = tokens.find((token) => token.includes(queryToken))
    if (!match) return -1
    score += match === queryToken ? 3 : match.startsWith(queryToken) ? 2 : 1
  }
  return score
}

function rank(entry: FileSearchEntry, query: string, queryTokens: string[]): [number, number, number, number, string, string, string] {
  const entryName = entry.name
  const nameLower = entryName.toLowerCase()
  const path = entry.path.replace(/\\/g, '/')
  const normalizedQuery = normalizedPath(query)
  const nameTokens = pathTokens(entryName)
  const entryPathTokens = pathTokens(entry.path)
  let tier = 5
  let fuzzy = 0

  if (nameLower === query.toLowerCase()) tier = 0
  else if (normalizedPath(entry.path) === normalizedQuery) tier = 1
  else if (queryTokens.length && queryTokens.every((token) => nameTokens.some((nameToken) => nameToken === token || nameToken.startsWith(token)))) tier = 2
  else if (queryTokens.length && nameLower.includes(query.toLowerCase())) tier = 3
  else if (queryTokens.length && (fuzzy = fuzzyScore(entryPathTokens, queryTokens)) >= 0) tier = 4

  return [tier, -fuzzy, path.split('/').length, path.length, normalizedPath(path), path, entry.name]
}

export function searchFiles(
  entries: readonly FileSearchEntry[],
  query: string,
  mode: FileSearchMode = 'all',
): FileSearchEntry[] {
  const queryTokens = tokenizeSearch(query)
  return entries
    .filter((entry) => !isExcluded(entry))
    .filter((entry) => mode === 'all' || (mode === 'files' ? !entry.isDirectory : entry.isDirectory))
    .map((entry) => ({ entry, score: rank(entry, query, queryTokens) }))
    .filter(({ score }) => !queryTokens.length || score[0] < 5)
    .sort((a, b) =>
      a.score[0] - b.score[0] ||
      a.score[1] - b.score[1] ||
      a.score[2] - b.score[2] ||
      a.score[3] - b.score[3] ||
      a.score[4].localeCompare(b.score[4]) ||
      a.score[5].localeCompare(b.score[5]) ||
      a.score[6].localeCompare(b.score[6]),
    )
    .map(({ entry }) => entry)
}
