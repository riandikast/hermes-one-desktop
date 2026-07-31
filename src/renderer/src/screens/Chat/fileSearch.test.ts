import { describe, expect, it } from 'vitest'
import { searchFiles, tokenizeSearch, type FileSearchEntry } from './fileSearch'

const entries: FileSearchEntry[] = [
  { name: 'README.md', isDirectory: false, path: 'docs/README.md' },
  { name: 'readme.md', isDirectory: false, path: 'README.md' },
  { name: 'package.json', isDirectory: false, path: 'packages/app/package.json' },
  { name: 'ChatInput.tsx', isDirectory: false, path: 'src/renderer/src/screens/Chat/ChatInput.tsx' },
  { name: 'chat-input.test.tsx', isDirectory: false, path: 'src/renderer/src/screens/Chat/chat-input.test.tsx' },
  { name: 'input.ts', isDirectory: false, path: 'src/renderer/src/screens/Chat/input.ts' },
  { name: 'README.md', isDirectory: false, path: 'node_modules/pkg/README.md' },
  { name: 'build', isDirectory: true, path: 'build' },
  { name: 'generated.ts', isDirectory: false, path: 'src/generated/generated.ts' },
  { name: 'Chat', isDirectory: true, path: 'src/Chat' },
  { name: 'Chat.ts', isDirectory: false, path: 'src/Chat.ts' },
  { name: 'generated.ts', isDirectory: false, path: 'src/generated.ts' },
  { name: 'needle.ts', isDirectory: false, path: 'a/needle.ts' },
  { name: 'needle.ts', isDirectory: false, path: 'a/deep/needle.ts' },
  { name: 'CASE.ts', isDirectory: false, path: 'z/CASE.ts' },
  { name: 'case.ts', isDirectory: false, path: 'a/case.ts' },
  { name: 'target', isDirectory: true, path: 'src/target' },
  { name: 'target.ts', isDirectory: false, path: 'src/target/target.ts' },
  { name: 'target.ts', isDirectory: false, path: 'src/target.ts' },
]

describe('tokenizeSearch', () => {
  it('normalizes separators and splits camelCase', () => {
    expect(tokenizeSearch('src\\ChatInput_file.ts')).toEqual(['src', 'chat', 'input', 'file', 'ts'])
  })

  it('matches slash and backslash separators equivalently', () => {
    expect(searchFiles(entries, 'src\\Chat.ts', 'files')[0]?.path).toBe('src/Chat.ts')
  })
})

describe('searchFiles', () => {
  it('ranks exact filename with extension before path and weaker basename matches', () => {
    const result = searchFiles(entries, 'README.md', 'files')
    expect(result.map((entry) => entry.path)).toEqual(['README.md', 'docs/README.md'])
  })

  it('matches exact basename case-insensitively', () => {
    expect(searchFiles(entries, 'CHATINPUT.TSX', 'files')[0]?.path).toBe(
      'src/renderer/src/screens/Chat/ChatInput.tsx',
    )
  })

  it('excludes generated directories and their contents', () => {
    const result = searchFiles(entries, '', 'all')
    expect(result.map((entry) => entry.path)).not.toContain('node_modules/pkg/README.md')
    expect(result.map((entry) => entry.path)).not.toContain('src/generated/generated.ts')
    expect(result.map((entry) => entry.path)).not.toContain('build')
  })

  it('ranks exact normalized relative path before basename token matches', () => {
    const result = searchFiles(entries, 'src/Chat.ts', 'files')
    expect(result[0]?.path).toBe('src/Chat.ts')
  })

  it('uses path as the deterministic tie breaker', () => {
    const result = searchFiles(entries, 'chat', 'files')
    expect(result.slice(0, 3).map((entry) => entry.path)).toEqual([
      'src/Chat.ts',
      'src/renderer/src/screens/Chat/ChatInput.tsx',
      'src/renderer/src/screens/Chat/chat-input.test.tsx',
    ])
  })

  it('uses depth before path length within a ranking tier', () => {
    expect(searchFiles(entries, 'needle.ts', 'files').slice(0, 2).map((entry) => entry.path)).toEqual([
      'a/needle.ts',
      'a/deep/needle.ts',
    ])
  })

  it('uses original path as a case-only tie breaker', () => {
    expect(searchFiles(entries, 'case.ts', 'files').slice(0, 2).map((entry) => entry.path)).toEqual([
      'a/case.ts',
      'z/CASE.ts',
    ])
  })

  it('does not exclude filenames that equal excluded directory names', () => {
    expect(searchFiles(entries, 'target.ts', 'files').map((entry) => entry.path)).toContain('src/target.ts')
  })

  it('ranks path-token fuzzy matches after basename matches', () => {
    const result = searchFiles(entries, 'renderer screen', 'files')
    const rendererMatch = result.findIndex((entry) => entry.path === 'src/renderer/src/screens/Chat/ChatInput.tsx')
    expect(rendererMatch).toBeGreaterThanOrEqual(0)
    expect(result.every((entry) => entry.path.includes('renderer'))).toBe(true)
  })

  it('filters files and folders', () => {
    expect(searchFiles(entries, 'chat', 'files').every((entry) => !entry.isDirectory)).toBe(true)
    expect(searchFiles(entries, 'chat', 'folders').map((entry) => entry.path)).toEqual(['src/Chat'])
  })
})
