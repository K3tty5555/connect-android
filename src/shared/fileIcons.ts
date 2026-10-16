/**
 * 文件类型 → material-icon-theme（MIT，v5.36.1）图标名的唯一映射来源。
 *
 * 用户拍板 2026-10-13：Mac、iPhone、iPad 三端文件图标统一为 material-icon-theme
 * 彩色类型图标。桌面（src/renderer/fileIcons.ts）按图标名静态引入 SVG；手机由
 * scripts/build-mobile-file-icons.mjs 把同一集合生成为 SVG 字符串模块。
 * 映射参考上游 dist/material-icons.json，按 Connect 用户常见文件取子集；本文件
 * 不得有 import（生成脚本由 Node 直接加载它）。
 */

export const FILE_ICON_NAMES = [
  'folder', 'folder-open', 'file',
  // 文档与 Office
  'word', 'table', 'powerpoint', 'pdf', 'document', 'markdown', 'mdx', 'readme', 'license', 'changelog', 'claude',
  // 媒体
  'image', 'svg', 'video', 'audio', 'subtitles',
  // 压缩包 / 字体 / 数据库 / 证书与密钥 / 数据
  'zip', 'font', 'database', 'certificate', 'key', 'xml', 'log', 'json', 'yaml', 'toml', 'settings', 'tune',
  'lock', 'diff',
  // 前端
  'typescript', 'react_ts', 'javascript', 'react', 'css', 'sass', 'less', 'html', 'vue',
  // 常见语言
  'python', 'python-misc', 'go', 'go-mod', 'rust', 'swift', 'java', 'kotlin', 'c', 'h', 'cpp', 'hpp', 'ruby',
  'gemfile', 'php', 'objective-c', 'objective-cpp', 'csharp', 'dart', 'lua', 'scala', 'jupyter', 'graphql',
  'proto', 'webassembly', 'console', 'powershell',
  // 工具链与配置
  'nodejs', 'npm', 'yarn', 'pnpm', 'tsconfig', 'git', 'docker', 'vite', 'vitest', 'eslint', 'prettier', 'jest',
  'babel', 'makefile', 'cmake', 'editorconfig',
] as const;

export type FileIconName = (typeof FILE_ICON_NAMES)[number];

/** 上游提供 `_light` 版的图标：日间主题改用浅底可读的版本。 */
export const FILE_ICON_LIGHT_VARIANTS: Readonly<Partial<Record<FileIconName, string>>> = {
  toml: 'toml_light',
  pnpm: 'pnpm_light',
};

const BY_EXTENSION: Readonly<Record<string, FileIconName>> = {
  doc: 'word', docx: 'word', rtf: 'word', odt: 'word', pages: 'word',
  xls: 'table', xlsx: 'table', xlsm: 'table', ods: 'table', csv: 'table', tsv: 'table', numbers: 'table',
  ppt: 'powerpoint', pptx: 'powerpoint', odp: 'powerpoint', keynote: 'powerpoint',
  pdf: 'pdf',
  mp4: 'video', mov: 'video', m4v: 'video', webm: 'video', mkv: 'video', avi: 'video', wmv: 'video', flv: 'video',
  mpg: 'video', mpeg: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', ogg: 'audio', opus: 'audio', aiff: 'audio',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', heic: 'image', heif: 'image',
  avif: 'image', bmp: 'image', ico: 'image', icns: 'image', tif: 'image', tiff: 'image',
  svg: 'svg',
  srt: 'subtitles', vtt: 'subtitles',
  zip: 'zip', gz: 'zip', tgz: 'zip', tar: 'zip', '7z': 'zip', rar: 'zip', bz2: 'zip', xz: 'zip', zst: 'zip',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
  db: 'database', sqlite: 'database', sqlite3: 'database', sql: 'database',
  crt: 'certificate', cer: 'certificate', p12: 'certificate', pfx: 'certificate',
  // .key 同时是 Keynote 后缀；沿用上游映射为密钥
  pem: 'key', pub: 'key', key: 'key',
  xml: 'xml', plist: 'xml',
  log: 'log',
  txt: 'document',
  json: 'json', jsonc: 'json', json5: 'json', jsonl: 'json',
  md: 'markdown', markdown: 'markdown', mdx: 'mdx',
  yml: 'yaml', yaml: 'yaml',
  toml: 'toml',
  ini: 'settings', conf: 'settings', cfg: 'settings', properties: 'settings',
  lock: 'lock',
  diff: 'diff', patch: 'diff',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'react_ts',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'react',
  css: 'css', scss: 'sass', sass: 'sass', less: 'less', html: 'html', htm: 'html', vue: 'vue',
  py: 'python', pyi: 'python', pyw: 'python',
  go: 'go', rs: 'rust', swift: 'swift', java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'h', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'hpp', hh: 'hpp',
  rb: 'ruby', php: 'php', m: 'objective-c', mm: 'objective-cpp', cs: 'csharp', dart: 'dart', lua: 'lua',
  scala: 'scala', ipynb: 'jupyter', graphql: 'graphql', gql: 'graphql', proto: 'proto', wasm: 'webassembly',
  sh: 'console', zsh: 'console', bash: 'console', fish: 'console', command: 'console', ps1: 'powershell',
};

const BY_FILENAME: Readonly<Record<string, FileIconName>> = {
  // macOS 目录元数据：上游无专用图标，用设置齿轮表达「系统文件」
  '.ds_store': 'settings',
  'package.json': 'nodejs', 'package-lock.json': 'lock', '.nvmrc': 'nodejs', '.node-version': 'nodejs',
  '.npmrc': 'npm', 'yarn.lock': 'yarn', '.yarnrc': 'yarn', '.yarnrc.yml': 'yarn',
  'pnpm-lock.yaml': 'pnpm', 'pnpm-workspace.yaml': 'pnpm',
  '.gitignore': 'git', '.gitattributes': 'git', '.gitmodules': 'git', '.gitkeep': 'git',
  dockerfile: 'docker', containerfile: 'docker', '.dockerignore': 'docker',
  'docker-compose.yml': 'docker', 'docker-compose.yaml': 'docker', 'compose.yml': 'docker', 'compose.yaml': 'docker',
  license: 'license', licence: 'license', copying: 'license',
  'changelog.md': 'changelog', changelog: 'changelog', 'claude.md': 'claude',
  '.babelrc': 'babel', makefile: 'makefile', gnumakefile: 'makefile', 'cmakelists.txt': 'cmake',
  '.editorconfig': 'editorconfig',
  'go.mod': 'go-mod', 'go.sum': 'go-mod',
  'requirements.txt': 'python-misc', 'pyproject.toml': 'python-misc', pipfile: 'python-misc',
  gemfile: 'gemfile', 'gemfile.lock': 'gemfile', podfile: 'ruby', 'podfile.lock': 'ruby',
  'cargo.toml': 'rust', 'cargo.lock': 'rust',
};

/** 带变体后缀的配置文件名（按顺序匹配小写文件名）。 */
const BY_PATTERN: ReadonlyArray<readonly [RegExp, FileIconName]> = [
  [/^tsconfig(\..+)?\.json$/u, 'tsconfig'],
  [/^\.env(\..+)?$/u, 'tune'],
  [/^readme(\..+)?$/u, 'readme'],
  [/^licen[cs]e\..+$/u, 'license'],
  [/^vite\.config\.[cm]?[jt]s$/u, 'vite'],
  [/^vitest\.(config|workspace)\.[cm]?[jt]s$/u, 'vitest'],
  [/^(eslint\.config\.[cm]?[jt]s|\.eslintrc(\..+)?)$/u, 'eslint'],
  [/^(prettier\.config\.[cm]?[jt]s|\.prettierrc(\..+)?)$/u, 'prettier'],
  [/^jest\.(config|setup)\.[cm]?[jt]s$/u, 'jest'],
  [/^babel\.config\.[cm]?[jt]s$/u, 'babel'],
];

/** `name` 可以是文件名或路径（/ 与 \ 都按分隔符处理）；大小写不敏感。 */
export function fileIconName(name: string, dir: boolean, open = false): FileIconName {
  if (dir) return open ? 'folder-open' : 'folder';
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1).toLowerCase();
  const byName = BY_FILENAME[base];
  if (byName) return byName;
  for (const [pattern, icon] of BY_PATTERN) if (pattern.test(base)) return icon;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'file';
  return BY_EXTENSION[base.slice(dot + 1)] ?? 'file';
}

/** 实际要画的图标文件名（不含 .svg）：日间主题有 `_light` 版时用之。 */
export function themedFileIconName(icon: FileIconName, theme: 'light' | 'dark'): string {
  return theme === 'light' ? FILE_ICON_LIGHT_VARIANTS[icon] ?? icon : icon;
}
