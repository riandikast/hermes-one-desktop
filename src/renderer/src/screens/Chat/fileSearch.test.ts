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
]

describe('tokenizeSearch', () => {
  it('normalizes separators and splits camelCase', () => {
    expect(tokenizeSearch('src\\ChatInput_file.ts')).toEqual(['src', 'chat', 'input', 'file', 'ts'])
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

  it('filters files and folders', () => {
    expect(searchFiles(entries, 'chat', 'files').every((entry) => !entry.isDirectory)).toBe(true)
    expect(searchFiles(entries, 'chat', 'folders').map((entry) => entry.path)).toEqual(['src/Chat'])
  })
})
