// repo-map.js
import { LANGUAGE_REGISTRY } from './language-config.js';
import { isIgnored, parseIgnoreFile } from './ignore-manager.js';

let parser = null;
const LOADED_LANGUAGES = {};

// 预计算所有支持的扩展名 Set，用于扫描阶段的快速过滤 (O(1) 复杂度)
const ALLOWED_EXTENSIONS = new Set(
    Object.values(LANGUAGE_REGISTRY).flatMap(conf => conf.extensions)
);

export async function initTreeSitter() {
    try {
        // 显式调用 window.TreeSitter 确保获取 index.html 注入的全局对象
        const TS = window.TreeSitter;
        if (!TS) throw new Error("TreeSitter global not found. Script load failed?");

        await TS.init({
            locateFile: () => {
                // Fallback logical or specific version locking
                return 'https://cdn.jsdelivr.net/npm/web-tree-sitter@0.20.8/tree-sitter.wasm';
            }
        });
        parser = new TS();
        // Warm up parser to prevent lag on first file processing
        parser.setTimeoutMicros(1000 * 1000); 
    } catch (e) {
        console.warn('TreeSitter init warning:', e);
    }
}

async function loadLanguageParser(ext) {
    const langConfig = Object.values(LANGUAGE_REGISTRY).find(conf => conf.extensions.includes(ext));
    if (!langConfig) return null;

    if (LOADED_LANGUAGES[langConfig.id]) {
        return langConfig;
    }

    try {
        // Explicitly use window.TreeSitter to ensure compatibility
        const langObj = await window.TreeSitter.Language.load(langConfig.wasm);
        LOADED_LANGUAGES[langConfig.id] = langObj;
        return langConfig;
    } catch (err) {
        return null;
    }
}
// 全局扫描状态，用于控制扫描阶段的 Yield
let lastScanYieldTime = 0;

async function scanDirectoryForMap(dirHandle, prefix, parentScopes, results) {
    // 即使有 .gitignore，也强制检查 .git 目录避免死循环；其他目录交由规则引擎判断
    if (dirHandle.name === '.git') return;

    // 释放主线程，防止 UI 在大项目扫描时冻结
    const now = performance.now();
    if (now - lastScanYieldTime > 16) { 
        await new Promise(resolve => setTimeout(resolve, 0));
        lastScanYieldTime = performance.now();
    }

    // 尝试读取当前目录下的 .gitignore
    let currentRules = [];
    try {
        const gitIgnoreHandle = await dirHandle.getFileHandle('.gitignore', { create: false }).catch(() => null);
        if (gitIgnoreHandle) {
            const file = await gitIgnoreHandle.getFile();
            const text = await file.text();
            currentRules = parseIgnoreFile(text);
        }
    } catch (e) { 
        // 忽略读取错误（如权限问题）
    }

    // 构建当前作用域链
    const currentScope = { basePath: prefix, rules: currentRules };
    const currentScopesStack = [...parentScopes, currentScope];

    try {
        for await (const entry of dirHandle.values()) {
            // 即使有 .gitignore，也再次强制检查 .git 目录避免死循环
            if (entry.name === '.git') continue;

            const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            
            // 基于层级作用域检查是否忽略
            if (isIgnored(fullPath, currentScopesStack)) continue;

            if (entry.kind === 'file') {
                const ext = entry.name.split('.').pop();
                // 性能优化：仅收集语言配置中支持的文件，大幅减少内存占用和后续处理开销
                if (ALLOWED_EXTENSIONS.has(ext)) {
                    results.push({ name: entry.name, path: fullPath, handle: entry });
                }
            } else {
                await scanDirectoryForMap(entry, fullPath, currentScopesStack, results);
            }
        }
    } catch (e) {
        // 遇到无权访问的目录静默跳过
    }
}

export async function generateRepoMap(dirHandle, globalIgnoreRules = []) {
    lastScanYieldTime = performance.now();

    // 确保 TreeSitter 已初始化
    if (!parser) {
        try {
            await initTreeSitter();
        } catch (e) {
            console.error(e);
        }
        if (!parser) throw new Error('TreeSitter failed to initialize.');
    }

    let mapOutput = [];
    const files = [];
    
    // 初始化全局忽略规则
    const rootScope = { basePath: '', rules: globalIgnoreRules };
    
    // 1. 扫描所有文件
    await scanDirectoryForMap(dirHandle, "", [rootScope], files);

    // 优化：按扩展名排序，使同类文件连续处理，减少 WASM 语言切换开销
    files.sort((a, b) => {
        const extA = a.name.split('.').pop();
        const extB = b.name.split('.').pop();
        if (extA !== extB) return extA.localeCompare(extB);
        return a.path.localeCompare(b.path);
    });

    // 2. 顺序解析文件内容
    let lastLangId = null; 
    const YIELD_INTERVAL_MS = 16;
    let lastYieldTime = performance.now();

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // 保持 UI 响应
        const now = performance.now();
        if (now - lastYieldTime > YIELD_INTERVAL_MS) {
            await new Promise(resolve => setTimeout(resolve, 0));
            lastYieldTime = performance.now();
        }

        const ext = file.name.split('.').pop();
        const config = await loadLanguageParser(ext);
        
        if (!config) continue;

        let tree = null;
        try {
            const fileObj = await file.handle.getFile();
            if (fileObj.size > 300 * 1024) continue;

            // 1. 二进制文件检测 (Binary Check)
            // 读取前 512 字节检查是否有空字节 (0x00)，这比读取全文更高效且安全
            const chunk = await fileObj.slice(0, 512).arrayBuffer();
            if (new Uint8Array(chunk).some(byte => byte === 0)) {
                mapOutput.push(`# Skipped binary file: ${file.name}`);
                continue;
            }

            const text = await fileObj.text();
            
            // 2. 检测是否为压缩代码 (Minified Code)
            const isSmallConfigFile = fileObj.size < 10 * 1024;
            const MAX_LINE_LENGTH = 2000;

            // 检查 A: 快速检查首段是否有换行
            const firstChunk = text.slice(0, 5000);
            const looksMinified = !isSmallConfigFile && firstChunk.length >= 2000 && !firstChunk.includes('\n');

            if (looksMinified) {
                mapOutput.push(`# Skipped minified file (heuristic): ${file.name}`);
                continue;
            }

            // 检查 B: 扫描超长单行 (避免正则回溯或解析器内存溢出)
            let hasLongLine = false;
            if (!isSmallConfigFile) {
                let lastNewlineIndex = -1;
                for (let j = 0; j < text.length; j++) {
                    if (text[j] === '\n') {
                        if (j - lastNewlineIndex > MAX_LINE_LENGTH) {
                            hasLongLine = true;
                            break;
                        }
                        lastNewlineIndex = j;
                    }
                }
                if (!hasLongLine && (text.length - lastNewlineIndex > MAX_LINE_LENGTH)) {
                    hasLongLine = true;
                }
            }

            if (hasLongLine) {
                mapOutput.push(`# Skipped file with overly long lines: ${file.name}`);
                continue;
            }

            const langInstance = LOADED_LANGUAGES[config.id];
            
            // 切换解析器语言状态
            if (lastLangId !== config.id) {
                try {
                    parser.setLanguage(langInstance);
                    lastLangId = config.id;
                } catch (langErr) {
                    console.error(`Failed to set language for ${config.id}`, langErr);
                    lastLangId = null; 
                    continue; 
                }
            }
            
            try {
                tree = parser.parse(text);
            } catch (parseErr) {
                mapOutput.push(`# Parser crashed on ${file.name}`);
                continue;
            }

            // 缓存查询对象 (Query Cache)
            let query = config._cachedQuery;
            if (!query) {
                query = langInstance.query(config.query);
                config._cachedQuery = query;
            }
            
            const captures = query.captures(tree.rootNode);
            
            const definitions = captures.map(c => {
                let rawText = config.formatter ? config.formatter(c, c.node.text) : c.node.text;
                if (!rawText) return null;
                
                let cleanText = rawText.split(/\r?\n/)[0].trim();
                cleanText = cleanText.replace(/\s*(=>|[{])$/, '').trim();
                
                // 简化赋值语句显示
                if (cleanText.includes(' = ')) {
                    const parts = cleanText.split(' = ');
                    // 排除箭头函数和 async
                    if (parts[1] && !parts[1].startsWith('(') && !parts[1].startsWith('async')) {
                        cleanText = `${parts[0]} = ...`;
                    }
                }
                
                // 截断过长定义
                if (cleanText.length > 60) cleanText = cleanText.substring(0, 57) + '...';
                return cleanText;
            }).filter(Boolean);

            const uniqueDefs = [...new Set(definitions)];

            if (uniqueDefs.length > 0) {
                mapOutput.push(`${file.path}:`);
                uniqueDefs.forEach(def => mapOutput.push(`  - ${def}`));
                mapOutput.push('');
            }
            
        } catch (err) {
            mapOutput.push(`# Error parsing ${file.name}: ${err.message}`);
        } finally {
            // 必须手动释放 WASM 内存
            if (tree) tree.delete();
        }
    }

    const result = mapOutput.join('\n');
    return result;
}