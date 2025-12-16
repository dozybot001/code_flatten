class ProjectProcessor {
    constructor() {
        this.config = APP_CONFIG;
        this.gitIgnoreRules = [];
    }

    parseGitIgnore(content) {
        this.gitIgnoreRules = content.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(rule => {
                const isDir = rule.endsWith('/');
                const clean = rule.replace(/\/$/, '');
                return { rule: clean, isDir }; 
            });
    }

    shouldIgnore(path) {
        path = path.replace(/\\/g, '/');
        const parts = path.split('/');
        const fileName = parts[parts.length - 1];
        if (parts.some(p => this.config.IGNORE_DIRS.includes(p))) return true;
        if (this.config.IGNORE_EXTS.some(ext => fileName.toLowerCase().endsWith(ext))) return true;

        if (this.gitIgnoreRules.length > 0) {
            for (const { rule, isDir } of this.gitIgnoreRules) {
                if (parts.includes(rule)) return true;
                if (rule.includes('/')) {
                    const normalizedRule = rule.startsWith('/') ?
                        rule.slice(1) : rule;
                    if (path === normalizedRule || 
                        path.startsWith(normalizedRule + '/') || 
                        path.includes('/' + normalizedRule + '/')) {
                        return true;
                    }
                }

                if (fileName === rule) return true;
                if (rule.startsWith('*') && fileName.endsWith(rule.slice(1))) return true;
            }
        }

        return false;
    }

    estimateTokens(text) {
        const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        const other = text.length - chinese;
        return Math.ceil(chinese * 1.5 + other * 0.25);
    }

    generateTree(paths) {
        let tree = {};
        paths.forEach(path => {
            path.replace(/\\/g, '/').split('/').reduce((r, k) => r[k] = r[k] || {}, tree);
        });
        const print = (node, prefix = "") => {
            let keys = Object.keys(node);
            return keys.map((key, i) => {
                let last = i === keys.length - 1;
                let str = prefix + (last ? "└── " : "├── ") + key + "\n";
                if (Object.keys(node[key]).length) str += print(node[key], prefix + (last ? "    " : "│   "));
        
                return str;
            }).join('');
        };
        return Object.keys(tree).length ? (paths.length > 1 ? "Root/\n" : "") + print(tree) : "";
    }

    async restoreFilesFromText(content, originalName = "forge_restored") {
        const markerRegex = /(?:^|\r?\n)[=-]{3,}\s*File:\s*(.*?)\s*[=-]{3,}(?:\r?\n|$)/g;
        const zip = new JSZip();
        let fileCount = 0;
        
        let match;
        let matches = [];
        while ((match = markerRegex.exec(content)) !== null) {
            matches.push({
                path: match[1].trim(),
                startIndex: match.index,
                endIndex: match.index + match[0].length
            });
        }

        if (matches.length === 0) {
            throw new Error("No file markers found (=== File: ... ===)");
        }

        let extractedName = originalName;
        if (matches.length > 0) {
            const firstPath = matches[0].path.replace(/\\/g, '/');
            const parts = firstPath.split('/');
            if (parts.length > 1) extractedName = parts[0];
        }

        for (let i = 0; i < matches.length; i++) {
            const current = matches[i];
            const next = matches[i + 1];
            const contentStart = current.endIndex;
            const contentEnd = next ?
                next.startIndex : content.length;
            let rawContent = content.substring(contentStart, contentEnd);
            
            let cleanPath = current.path
                .replace(/\\/g, '/')
                .replace(/^(\.\/|\/)+/, '')
                .replace(/(^|[\/\\])\.\.([\/\\]|$)/g, '$1$2');
            if (!cleanPath || cleanPath.endsWith('/')) continue;
            rawContent = rawContent.replace(/^\s*[\r\n]/, '').replace(/[\r\n]\s*$/, '');
            zip.file(cleanPath, rawContent);
            fileCount++;
        }

        if (fileCount > 0) {
            const blob = await zip.generateAsync({type:"blob"});
            return { blob, fileCount, extractedName };
        } else {
            throw new Error("No valid files extracted.");
        }
    }
}

function generateTimeStr(date) {
    return date.getFullYear() +
           String(date.getMonth() + 1).padStart(2, '0') +
           String(date.getDate()).padStart(2, '0') + "_" +
           String(date.getHours()).padStart(2, '0') +
           String(date.getMinutes()).padStart(2, '0');
}

async function scanFiles(entries, processorInstance, encoding = 'UTF-8', pathPrefix = "") {
    let results = [];
    for (const entry of entries) {
        if (!entry) continue;
        const fullPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;

        if (entry.isFile) {
            if (processorInstance.shouldIgnore(fullPath)) continue;
            try {
                const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
                const processed = await processSingleFile(file, fullPath, processorInstance, encoding);
                if (processed) results.push(processed);
            } catch (err) { console.warn(`Error reading ${fullPath}`, err);
            }
        } else if (entry.isDirectory) {
            if (processorInstance.shouldIgnore(fullPath)) continue;
            const dirReader = entry.createReader();
            const childEntries = await new Promise((resolve, reject) => {
                dirReader.readEntries(resolve, reject);
            });
            const childResults = await scanFiles(childEntries, processorInstance, encoding, fullPath);
            results = results.concat(childResults);
        }
    }
    return results;
}

async function processSingleFile(file, path, processorInstance, encoding = 'UTF-8') {
    if (file.size > processorInstance.config.MAX_FILE_SIZE) {
        return { 
            file, path, 
            content: `// [WARN] File skipped: size (${(file.size/1024/1024).toFixed(2)}MB) exceeds limit.\n`, 
            selected: true 
        };
    }

    if (file.name === '.gitignore') {
        const text = await readFileAsText(file, encoding);
        processorInstance.parseGitIgnore(text);
        return null; 
    }

    try {
        const text = await readFileAsText(file, encoding);
        return { file, path, content: text, selected: true };
    } catch (err) { 
        console.warn(`Skipped binary or error: ${path}`);
        return null;
    }
}

function readFileAsText(file, encoding = 'UTF-8') {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file, encoding);
    });
}