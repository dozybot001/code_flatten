const DEFAULT_IGNORE_CONTENT = `
# --- Version Control & IDEs ---
.git
.svn
.hg
.idea
.vscode
.vs
.history
*.swp

# --- Operating System Files ---
.DS_Store
Thumbs.db
desktop.ini
$RECYCLE.BIN
*.lnk

# --- Dependencies & Packages ---
node_modules
bower_components
jspm_packages
web_modules
venv
.venv
__pycache__
.mvn
vendor
.bundle

# --- Build Outputs & Dist ---
dist
build
out
target
coverage
.nuxt
.next
.astro
.svelte-kit
.vercel
.output
.cache
.parcel-cache
.turbo
.wrangler
public/build
storybook-static
.docusaurus

# --- Package Manager Cache ---
.npm
.yarn
.pnpm-store
.bun

# --- Testing & Coverage ---
coverage
.nyc_output
.pytest_cache
test-results
playwright-report
blob-report

# --- Modern Build Tools ---
.turbo
.gradle
.terraform
.serverless

# --- Logs & Debug ---
*.log
npm-debug.log*
yarn-error.log*
yarn-debug.log*
pnpm-debug.log*
lerna-debug.log*
hs_err_pid*

# --- Environment & Secrets (Security) ---
.env
.env.local
.env.*.local
*.pem
*.key
*.cert
*.pfx
id_rsa
id_rsa.pub
secrets.yaml

# --- Binary / Media Assets ---
*.png
*.jpg
*.jpeg
*.gif
*.webp
*.ico
*.svg
*.bmp
*.tiff
*.raw
*.psd
*.ai
*.mp4
*.m4v
*.mov
*.avi
*.mkv
*.webm
*.mp3
*.wav
*.flac
*.aac
*.ogg

# --- Binary / Documents & Fonts ---
*.pdf
*.doc
*.docx
*.xls
*.xlsx
*.ppt
*.pptx
*.zip
*.tar
*.tar.gz
*.rar
*.7z
*.gz
*.iso
*.exe
*.dll
*.so
*.dylib
*.bin
*.dmg
*.woff
*.woff2
*.ttf
*.eot
*.otf
*.wasm

# --- Lock Files (Token Saving) ---
package-lock.json
yarn.lock
pnpm-lock.yaml
bun.lockb
poetry.lock
Gemfile.lock
composer.lock
uv.lock

# --- Minified & Source Maps ---
*.min.js
*.min.css
*.map
`;

/**
 * Loads default ignore rules from the embedded constant.
 * Uses a built-in static list to ensure offline capability and zero-latency.
 * @returns {Promise<string[]>} Array of parsed ignore rules
 */
export async function fetchIgnoreRules() {
    return parseIgnoreFile(DEFAULT_IGNORE_CONTENT);
}

/**
 * Parses ignore file content into an array of rules
 * @param {string} text 
 * @returns {string[]}
 */
export function parseIgnoreFile(text) {
    if (!text) return [];
    return text.split(/\r?\n/)
        .map(line => line.trim())
        // Remove empty lines and comments (but keep escaped \# lines)
        .filter(line => line && !line.startsWith('#')); 
}

/**
 * Checks if a file matches any rule in the active scopes.
 * Implements "Last Match Wins" strategy (Git behavior).
 * * @param {string} fullPath - The full relative path from root
 * @param {Array<{basePath: string, rules: string[]}>} scopes - Stack of ignore scopes
 * @returns {boolean}
 */
export function isIgnored(fullPath, scopes) {
    const normPath = fullPath.replace(/\\/g, '/');
    let ignored = false;

    // 遍历所有作用域 (从 Root 到 Deepest)，层级越深优先级越高
    for (const scope of scopes) {
        if (scope.basePath && !normPath.startsWith(scope.basePath + '/')) continue;

        const relativePath = scope.basePath 
            ? normPath.slice(scope.basePath.length + 1) 
            : normPath;
        
        if (!relativePath) continue;

        // 遍历规则 (从上到下)，后面的规则覆盖前面的规则 (Last Match Wins)
        for (const rule of scope.rules) {
            const isNegative = rule.startsWith('!');
            const pattern = isNegative ? rule.slice(1) : rule;
            
            if (checkRule(relativePath, pattern)) {
                ignored = !isNegative; // 如果匹配了 !rule，则 ignored = false (不忽略)
            }
        }
    }
    return ignored;
}

// Cache for compiled Regex instances to avoid overhead in large loops
const REGEX_CACHE = new Map();

/**
 * Validates a single gitignore rule against a scoped relative path
 * Uses Regex for accurate glob matching (* vs **)
 */
function checkRule(path, pattern) {
    if (!pattern) return false;
    
    // 1. Directory match optimization
    let cleanPattern = pattern;
    if (cleanPattern.endsWith('/')) cleanPattern = cleanPattern.slice(0, -1);

    // 2. Determine if it's a "rooted" check or "recursive" check
    // 只要包含 / (且不是在末尾)，就被视为路径相关的匹配，而非纯文件名匹配
    const isRooted = cleanPattern.startsWith('/') || cleanPattern.indexOf('/') > -1;
    
    if (isRooted) {
        if (cleanPattern.startsWith('/')) cleanPattern = cleanPattern.slice(1);
        // 根路径匹配必须允许路径遍历匹配
        const regex = getOrCompileRegex(cleanPattern, true);
        // 如果原始规则以 / 结尾（在 optimization 步骤被去除了），则必须确保匹配项也是目录前缀
        // 注意：由于 path 可能是 'dir/file'，简单的 regex.test(path) 可能会误判，
        // 但在此架构下，只要路径前缀匹配即视为忽略，通常是符合预期的。
        return regex.test(path);
    } else {
        // Recursive match
        const filename = path.split('/').pop();
        if (cleanPattern === filename) return true;

        const parts = path.split('/');
        if (parts.includes(cleanPattern)) return true;

        if (cleanPattern.includes('*') || cleanPattern.includes('?')) {
            const regex = getOrCompileRegex(cleanPattern, false);
            return regex.test(filename);
        }
        
        return false;
    }
}

/**
 * Retrieves a cached RegExp or compiles a new one
 */
function getOrCompileRegex(pattern, allowPathTraversal) {
    const key = `${pattern}::${allowPathTraversal}`;
    if (REGEX_CACHE.has(key)) {
        return REGEX_CACHE.get(key);
    }

    const regex = makeGlobRegex(pattern, allowPathTraversal);
    REGEX_CACHE.set(key, regex);
    return regex;
}

/**
 * 将 gitignore 的 glob 模式转换为 JavaScript RegExp
 * 处理了 ** (递归) 和 * (当前层级) 的区别
 */
function makeGlobRegex(pattern, allowPathTraversal) {
    const DOUBLE_STAR_PLACEHOLDER = '___DOUBLE_STAR___';
    
    // 1. 保护 ** 符号
    let src = pattern.replace(/\*\*/g, DOUBLE_STAR_PLACEHOLDER);

    // 2. 转义正则特殊字符 (必须包含 * 和 ?，否则会被当做正则量词处理)
    // 避免转义 [ ]，允许 pattern 如: image.[a-z]png
    src = src.replace(/[.+^${}()|\\*?]/g, '\\$&');

    // 3. 还原 ** 为跨目录匹配 (.*)
    // 必须非贪婪匹配目录分隔符，但 gitignore 的 ** 通常行为较复杂
    // 这里使用简化的 .* 模拟
    src = src.split(DOUBLE_STAR_PLACEHOLDER).join('.*');

    // 4. 将单个 * (已被转义为 \*) 还原为当前目录匹配 (非 / 字符)
    src = src.replace(/\\\*/g, '[^/]*');

    // 5. 将 ? (已被转义为 \?) 还原为单字符匹配
    src = src.replace(/\\\?/g, '[^/]');

    if (allowPathTraversal) {
        // 允许匹配目录本身及其子内容 (例如规则 "node_modules" 匹配 "node_modules/foo.js")
        return new RegExp(`^${src}(?:/.*)?$`);
    } else {
        // 精确匹配文件名
        return new RegExp(`^${src}$`);
    }
}