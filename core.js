export const ProjectCore = {
    // ... (保留之前的 ignore 逻辑) ...
    DEFAULT_IGNORE_RULES: [
        '.git', 'node_modules', '.DS_Store', 'dist', 'build', 
        '.vscode', '.idea', 'coverage', '*.log', 'npm-debug.log',
        'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
    ],
    activeIgnoreRules: [],

    globToRegex(pattern) {
        const cleanPattern = pattern.replace(/\/$/, '');
        let re = cleanPattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '.*')
            .replace(/(^|[^\\])\*/g, '$1[^/]*')
            .replace(/\?/g, '[^/]');
        return new RegExp(`(^|/)${re}(/|$)`);
    },

    shouldIgnore(path, rules) {
        return rules.some(regex => regex.test(path));
    },
    parseIgnoreRules(content) {
        if (!content) return [];
        return content.split(/\r?\n/).filter(line => line.trim() !== '');
    },

    _sortChildren(childrenMap) {
        return Array.from(childrenMap.values()).sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    },

    async buildFileTree(files) {
        // ... (保持原样) ...
        if (!files.length) return null;
        const fileArray = Array.from(files);

        let firstPath = fileArray[0].webkitRelativePath || fileArray[0].name;
        let projectName = firstPath.split('/')[0];
        if (projectName === firstPath) projectName = 'Project';

        let systemRulesRegex = [];
        const defaultRegex = this.DEFAULT_IGNORE_RULES.map(r => this.globToRegex(r));
        systemRulesRegex = [...defaultRegex];

        try {
            const response = await fetch('assets/ignore.txt');
            if (response.ok) {
                const text = await response.text();
                const rules = this.parseIgnoreRules(text);
                const fileRulesRegex = rules
                    .filter(r => r && !r.trim().startsWith('#'))
                    .map(r => this.globToRegex(r.trim()));
                systemRulesRegex = [...systemRulesRegex, ...fileRulesRegex];
            }
        } catch (e) {
            console.warn("Failed to load system ignore.txt, using defaults only", e);
        }
        const root = { 
            id: projectName, 
            name: projectName, 
            type: 'dir', 
            children: new Map(),
            selected: true 
        };

        fileArray.forEach(file => {
            const relativePath = file.webkitRelativePath || `${projectName}/${file.name}`;
            const parts = relativePath.split('/');
            const pathParts = parts.length > 1 ? parts.slice(1) : [parts[0]];
            
            let currentNode = root;
            let currentPath = projectName;

            pathParts.forEach((part, index) => {
                const isFile = index === pathParts.length - 1;
                currentPath = `${currentPath}/${part}`;
                
                if (!currentNode.children.has(part)) {
                    currentNode.children.set(part, {
                        id: currentPath,
                        name: part,
                        type: isFile ? 'file' : 'dir',
                        file: isFile ? file : null,
                        children: new Map(), 
                        selected: true
                    });
                }
                currentNode = currentNode.children.get(part);
            });
        });

        await this._recursivePrune(root, projectName, systemRulesRegex);

        return { root, projectName };
    },

    async _recursivePrune(node, currentPath, parentRules) {
        // ... (保持原样) ...
        let localRulesRegex = [];
        if (node.children.has('.gitignore')) {
            const gitIgnoreNode = node.children.get('.gitignore');
            if (gitIgnoreNode.type === 'file' && gitIgnoreNode.file) {
                try {
                    const content = await this.readFileContent(gitIgnoreNode.file);
                    const rawRules = this.parseIgnoreRules(content);
                    
                    localRulesRegex = rawRules
                        .filter(r => r && !r.trim().startsWith('#'))
                        .map(rule => {
                            const trimmed = rule.trim();
                            if (trimmed.startsWith('/')) {
                                const cleanRule = trimmed.slice(1);
                                const fullPath = currentPath ? `${currentPath}/${cleanRule}` : cleanRule;
                                return this.globToRegex(fullPath);
                            } else {
                                return this.globToRegex(trimmed);
                            }
                        });
                } catch (e) {
                    console.warn(`Error reading .gitignore at ${currentPath}`, e);
                }
            }
        }
        const activeRules = [...parentRules, ...localRulesRegex];
        for (const key of Array.from(node.children.keys())) {
            const child = node.children.get(key);
            if (this.shouldIgnore(child.id, activeRules)) {
                node.children.delete(key);
                continue; 
            }
            if (child.type === 'dir') {
                await this._recursivePrune(child, child.id, activeRules);
            }
        }
    },

    flattenTree(root) {
        // ... (保持原样) ...
        const flatList = [];
        flatList.push({
            ...root,
            prefix: '',
            connector: '', 
            children: undefined 
        });

        const traverse = (node, prefix = '') => {
            const children = this._sortChildren(node.children);
            children.forEach((child, index) => {
                const isLast = index === children.length - 1;
                const connector = isLast ? '└── ' : '├── ';
                flatList.push({
                    ...child,
                    prefix: prefix,       
                    connector: connector, 
                    children: undefined 
                });
                if (child.type === 'dir') {
                    const childPrefix = prefix + (isLast ? '    ' : '│   ');
                    traverse(child, childPrefix);
                }
            });
        };
        traverse(root);
        return flatList;
    },

    readFileContent(file) {
        // ... (保持原样) ...
        return new Promise((resolve) => {
            const isBinaryExt = /\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|zip|rar|pdf|exe|dll|bin)$/i.test(file.name);
            if (isBinaryExt) return resolve(`[Binary File: ${file.name} Omitted]`);

            const MAX_SIZE = 1024 * 1024; 
            if (file.size > MAX_SIZE) {
                return resolve(`[File too large: ${file.name} (${(file.size / 1024).toFixed(2)} KB) Omitted for performance]`);
            }

            const HEADER_SIZE = 512;
            const headerBlob = file.slice(0, HEADER_SIZE);
            const headerReader = new FileReader();

            headerReader.onload = (e) => {
                const buffer = new Uint8Array(e.target.result);
                const isBinary = buffer.some(byte => byte === 0);

                if (isBinary) {
                    resolve(`[Binary Content Detected: ${file.name} Omitted]`);
                } else {
                    const fullReader = new FileReader();
                    fullReader.onload = (ev) => resolve(ev.target.result);
                    fullReader.onerror = () => resolve(`[Error reading ${file.name}]`);
                    fullReader.readAsText(file);
                }
            };
            headerReader.onerror = () => resolve(`[Error reading header of ${file.name}]`);
            headerReader.readAsArrayBuffer(headerBlob);
        });
    },

    generateTreeString(flatStructure, projectName) {
        // ... (保持原样) ...
        const selectedNodes = flatStructure.filter(n => n.selected);
        if (selectedNodes.length === 0) return 'Project Tree:\n(No files selected)\n';
        const tempRoot = { name: projectName, children: new Map() };
        
        selectedNodes.forEach(node => {
            if (node.id === projectName) return;
            const parts = node.id.split('/');
            const relativeParts = parts.slice(1);
            let current = tempRoot;
            
            relativeParts.forEach((part, index) => {
                if (!current.children.has(part)) {
                    current.children.set(part, { name: part, type: 'dir', children: new Map() });
                }
                current = current.children.get(part);
                if (index === relativeParts.length - 1) current.type = node.type;
            });
        });
        const lines = ["Project Tree:", `${tempRoot.name}/`];
        const buildLines = (node, prefix = '') => {
            const children = this._sortChildren(node.children);
            children.forEach((child, index) => {
                const isLast = index === children.length - 1;
                const connector = isLast ? '└── ' : '├── ';
                lines.push(`${prefix}${connector}${child.name}${child.type === 'dir' ? '/' : ''}`);
                if (child.children.size > 0) {
                    buildLines(child, prefix + (isLast ? '    ' : '│   '));
                }
            });
        };
        buildLines(tempRoot);
        return lines.join('\n') + '\n';
    },

    async generateFullContext(selectedFiles, flatStructure, projectName) {
        // ... (保持原样) ...
        const treePart = this.generateTreeString(flatStructure, projectName);
        const separator = "=".repeat(48);
        const BATCH_SIZE = 50; 
        const fileContents = [];
        for (let i = 0; i < selectedFiles.length; i += BATCH_SIZE) {
            const batch = selectedFiles.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(async (node) => {
                try {
                    const content = await this.readFileContent(node.file);
                    const ext = node.name.split('.').pop() || '';
                    return `=== File: ${node.id} ===\n\`\`\`${ext}\n${content}\n\`\`\``;
                } catch (e) {
                    console.error(`Failed to read ${node.name}`, e);
                    return `=== File: ${node.id} ===\n[Error reading file]`;
                }
            }));
            fileContents.push(...batchResults);
        }
        return `# Project Context\n\n${treePart}\n${separator}\n\n${fileContents.join('\n\n')}`;
    },

    async rebuildProject(fullText) {
        // ... (保持原样) ...
        if (typeof JSZip === 'undefined') {
            throw new Error("JSZip library not loaded.");
        }
        const zip = new JSZip();
        let count = 0;
        let projectName = 'RestoredProject';
        const treeMatch = fullText.match(/^Project Tree:\n(.*?)\//m);
        if (treeMatch && treeMatch[1]) {
            projectName = treeMatch[1].trim();
        }
        let currentIndex = 0;
        const fileHeaderMarker = '=== File: ';
        while (true) {
            const headerStart = fullText.indexOf(fileHeaderMarker, currentIndex);
            if (headerStart === -1) break;
            const headerLineEnd = fullText.indexOf('\n', headerStart);
            if (headerLineEnd === -1) break;
            const headerLine = fullText.substring(headerStart, headerLineEnd);
            const filePath = headerLine.replace(fileHeaderMarker, '').replace(' ===', '').trim();
            const codeBlockStart = fullText.indexOf('```', headerLineEnd);
            if (codeBlockStart === -1) {
                currentIndex = headerLineEnd;
                continue;
            }
            const contentStart = fullText.indexOf('\n', codeBlockStart) + 1;
            let nextHeaderIndex = fullText.indexOf(fileHeaderMarker, contentStart);
            if (nextHeaderIndex === -1) {
                nextHeaderIndex = fullText.length;
            }
            const contentEnd = fullText.lastIndexOf('```', nextHeaderIndex);
            if (contentEnd > contentStart) {
                let fileContent = fullText.substring(contentStart, contentEnd);
                if (fileContent.endsWith('\n')) {
                    fileContent = fileContent.slice(0, -1);
                }
                let relativePath = filePath;
                const prefix = `${projectName}/`;
                if (relativePath.startsWith(prefix)) {
                    relativePath = relativePath.substring(prefix.length);
                }
                if (!relativePath) relativePath = `root_file_${count}.txt`;
                zip.file(relativePath, fileContent);
                count++;
            }
            currentIndex = nextHeaderIndex;
        }
        if (count === 0) {
            throw new Error("No file patterns found in the context text.");
        }
        console.log(`Rebuilt ${count} files.`);
        return {
            blob: await zip.generateAsync({ type: "blob" }),
            fileName: `${projectName}_Rebuilt.zip`
        };
    },

    // --- Patch Engine (Powered by Google diff-match-patch) ---
    PatchEngine: {
        getDmp() {
            if (typeof diff_match_patch === 'undefined') {
                throw new Error("diff_match_patch library not loaded. Please check index.html");
            }
            const dmp = new diff_match_patch();
            dmp.Match_Threshold = 0.2; 
            dmp.Match_Distance = 10000; 
            return dmp;
        },

        parseInput(inputText) {
            const lines = inputText.split(/\r?\n/);
            const patches = [];
            
            let state = 'IDLE'; 
            let currentFile = '';
            let searchBuffer = [];
            let replaceBuffer = [];

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                if (state === 'IDLE') {
                    if (trimmed.startsWith('FILE:')) {
                        currentFile = trimmed.replace(/^FILE:\s*/, '').trim();
                    } else if (trimmed.startsWith('<<<<<<< SEARCH')) {
                        state = 'SEARCH';
                        searchBuffer = [];
                    }
                } else if (state === 'SEARCH') {
                    if (trimmed.startsWith('=======')) {
                        state = 'REPLACE';
                        replaceBuffer = [];
                    } else {
                        searchBuffer.push(line);
                    }
                } else if (state === 'REPLACE') {
                    if (trimmed.startsWith('>>>>>>> REPLACE')) {
                        // FIX: Ensure search block is joined with simple \n
                        const searchBlock = searchBuffer.join('\n').replace(/^\n+|\n+$/g, '');
                        const replaceBlock = replaceBuffer.join('\n').replace(/^\n+|\n+$/g, '');
                        
                        if (currentFile) {
                            patches.push({
                                targetFile: currentFile,
                                search: searchBlock,
                                replace: replaceBlock
                            });
                        }
                        state = 'IDLE';
                    } else {
                        replaceBuffer.push(line);
                    }
                }
            }
            return patches;
        },

        findMatches(fullContext, patches) {
            const results = [];
            let dmp;
            try { dmp = this.getDmp(); } catch(e) { console.error(e); return []; }

            patches.forEach((patch, index) => {
                const fileHeaderPattern = `=== File: ${patch.targetFile} ===`;
                const fileStartIndex = fullContext.indexOf(fileHeaderPattern);
                
                if (fileStartIndex === -1) {
                    results.push({
                        id: `patch-${index}-err`,
                        isValid: false,
                        file: patch.targetFile,
                        original: patch.search,
                        error: `File '${patch.targetFile}' not found in current context.`
                    });
                    return;
                }

                // FIX: Ensure we start searching AFTER the header
                const contentStartOffset = fileStartIndex + fileHeaderPattern.length;
                const nextFileIndex = fullContext.indexOf('=== File: ', contentStartOffset);
                const fileEndIndex = nextFileIndex !== -1 ? nextFileIndex : fullContext.length;
                
                // Extract content logic
                const rawFileContentSlice = fullContext.substring(contentStartOffset, fileEndIndex);
                
                // CRITICAL FIX: Normalize Line Endings to \n for search
                // This ensures Windows CRLF text matches logic's LF
                const fileContentSlice = rawFileContentSlice.replace(/\r\n/g, '\n');

                let loc = -1;

                // 1. Fuzzy Match (DMP)
                try {
                    if (patch.search.length > 2000) {
                        throw new Error("Search block too large for fuzzy match");
                    }
                    loc = dmp.match_main(fileContentSlice, patch.search, 0);
                } catch (e) {
                    console.warn(`Fuzzy match skipped for patch ${index} (fallback to exact match):`, e.message);
                    loc = -1;
                }

                // 2. Exact Match (Fallback)
                if (loc === -1) {
                    loc = fileContentSlice.indexOf(patch.search);
                }

                if (loc !== -1) {
                    // Re-calculate absolute index based on Raw Context (which might have CRLF)
                    // If we used normalized string for finding, we must map back carefully.
                    // Simplified strategy: Use the normalized location, but we might drift if CRLF exists.
                    // BETTER STRATEGY: If normalized match works, assume it's valid, but apply patch using DMP later.
                    
                    // Note: 'start' and 'end' here are primarily for UI highlighting or splicing.
                    // Since we are modifying 'contextContent' (a string), we need exact indices.
                    // If we found it in normalized string, we need to find it in raw string.
                    
                    let absoluteStart = -1;
                    
                    // Attempt to find the raw string in raw context using the 'normalized match' hints?
                    // Or simply perform dmp.match_main on the raw slice again (DMP handles CRLF usually better than indexOf)
                    
                    // Let's stick to the slice logic. If we found it in normalized, it exists.
                    // Let's rely on DMP's patch_apply to do the heavy lifting later, 
                    // here we just need to confirm validity.
                    
                    absoluteStart = contentStartOffset + loc; 
                    
                    results.push({
                        id: `patch-${index}`,
                        file: patch.targetFile,
                        start: absoluteStart, // These indices are approximate if CRLF differs
                        end: absoluteStart + patch.search.length, 
                        original: patch.search,
                        replacement: patch.replace,
                        isValid: true,
                        localStart: loc // Used for DMP patching later
                    });
                } else {
                    results.push({
                        id: `patch-${index}-err`,
                        isValid: false,
                        file: patch.targetFile,
                        original: patch.search,
                        error: "Match Failed. The 'Search' block could not be found via fuzzy or exact match."
                    });
                }
            });
            return results;
        },

        applyPatches(fullContext, selectedMatches) {
            let dmp;
            try { dmp = this.getDmp(); } catch(e) { return fullContext; }

            const patchesByFile = {};
            selectedMatches.forEach(m => {
                if (!patchesByFile[m.file]) patchesByFile[m.file] = [];
                patchesByFile[m.file].push(m);
            });

            // Iterate and apply
            // CRITICAL: We must rebuild the context string file by file
            
            // To be safe, we split the context into files first to avoid index drift
            // But for simplicity, let's use the file header locators.
            
            let newFullContext = fullContext;

            // We must process from bottom to top to preserve indices, 
            // OR process file chunks independently.
            // Let's process file chunks.
            
            const fileHeaders = [];
            const regex = /=== File: (.*?) ===/g;
            let match;
            while ((match = regex.exec(newFullContext)) !== null) {
                fileHeaders.push({ file: match[1], index: match.index, length: match[0].length });
            }
            
            // Sort patches by file, then process reversed so string lengths don't mess up
            // Actually, apply_patch on a specific file block is safer.
            
            // Re-finding files in the potentially modified context is hard if we do it sequentially in one string.
            // Better strategy: Split context into chunks, patch chunks, join chunks.
            
            // Simplified approach compatible with current architecture:
            // Since we only have a few files, we can just replace the specific file block.
            
            Object.keys(patchesByFile).forEach(fileName => {
                const matches = patchesByFile[fileName];
                
                const fileHeader = `=== File: ${fileName} ===`;
                const startIdx = newFullContext.indexOf(fileHeader);
                if (startIdx === -1) return; 

                const contentStart = startIdx + fileHeader.length;
                const nextFileIdx = newFullContext.indexOf('=== File: ', contentStart);
                const endIdx = nextFileIdx !== -1 ? nextFileIdx : newFullContext.length;
                
                // Extract ONLY the content part (including markdown fences if any)
                const originalFileBlock = newFullContext.substring(contentStart, endIdx);
                
                // Normalization for Patching?
                // DMP handles it, but we should be careful. 
                // Ideally, we normalize the block to LF before patching, then patch, then (maybe) restore?
                // Let's just normalize to LF. Most code tools prefer LF.
                const normalizedBlock = originalFileBlock.replace(/\r\n/g, '\n');

                const dmpPatches = matches.map(m => {
                    const p = new diff_match_patch.patch_obj();
                    p.diffs = [];
                    // Ensure patch considers normalized newlines
                    p.diffs.push([-1, m.original.replace(/\r\n/g, '\n')]); 
                    p.diffs.push([1, m.replacement]);
                    p.start1 = m.localStart || 0; 
                    p.start2 = m.localStart || 0;
                    p.length1 = m.original.length;
                    p.length2 = m.replacement.length;
                    return p;
                });

                // Apply patch to the normalized block
                const [patchedFileBlock, applyResults] = dmp.patch_apply(dmpPatches, normalizedBlock);

                applyResults.forEach((success, i) => {
                    if (!success) console.warn(`Patch ${i} for ${fileName} might have failed or applied imperfectly.`);
                });

                // Replace in the big string
                // We replaced substring(contentStart, endIdx) with patchedFileBlock
                newFullContext = newFullContext.substring(0, contentStart) + patchedFileBlock + newFullContext.substring(endIdx);
            });

            return newFullContext;
        }
    }
};