// Use jsdelivr to match the loader script and ensure consistent versioning/uptime
export const TS_BASE_URL = 'https://cdn.jsdelivr.net/npm/tree-sitter-wasms@latest/out';
const getWasmPath = (lang) => `${TS_BASE_URL}/tree-sitter-${lang}.wasm`;
const standardFormatter = (kind) => (capture, text) => {
    if (capture.name === 'name') return null; // 忽略仅捕获名称的节点，只处理定义节点
    return `${kind} ${text}`;
};

export const LANGUAGE_REGISTRY = {
    // --- Web Frontend ---
    javascript: {
        id: 'javascript',
        wasm: getWasmPath('javascript'),
        extensions: ['js', 'jsx', 'mjs', 'cjs'],
        query: `
            (function_declaration name: (identifier) @name) @def
            (class_declaration name: (identifier) @name) @def
            (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)]) @def
            (method_definition name: (property_identifier) @name) @def
            (export_statement) @export
        `,
        formatter: (capture, text) => {
            if (capture.name === 'export') return text.startsWith('export default') ? 'export default' : 'export';
            if (capture.name === 'name') return null;
            return `def ${text}`;
        }
    },
    typescript: {
        id: 'typescript',
        wasm: getWasmPath('typescript'),
        extensions: ['ts', 'mts', 'cts'],
        query: `
            (function_declaration name: (identifier) @name) @def
            (class_declaration name: (identifier) @name) @def
            (interface_declaration name: (type_identifier) @name) @def
            (type_alias_declaration name: (type_identifier) @name) @def
            (enum_declaration name: (identifier) @name) @def
            (method_definition name: (property_identifier) @name) @def
            (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)]) @def
            (export_statement) @export
        `,
        formatter: (capture, text) => {
            if (capture.name === 'export') return text.startsWith('export default') ? 'export default' : 'export';
            return standardFormatter('ts')(capture, text);
        }
    },
    tsx: {
        id: 'tsx',
        wasm: getWasmPath('tsx'),
        extensions: ['tsx'],
        query: `
            (function_declaration name: (identifier) @name) @def
            (class_declaration name: (identifier) @name) @def
            (interface_declaration name: (type_identifier) @name) @def
            (type_alias_declaration name: (type_identifier) @name) @def
            (enum_declaration name: (identifier) @name) @def
            (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)]) @def
            (method_definition name: (property_identifier) @name) @def
        `,
        formatter: standardFormatter('tsx')
    },
    html: {
        id: 'html',
        wasm: getWasmPath('html'),
        extensions: ['html', 'htm'],
        query: `
            (attribute (attribute_name) @attr_name (quoted_attribute_value) @attr_value (#match? @attr_name "^(id|class)$"))
            (script_element) @script
            (style_element) @style
        `,
        formatter: (capture) => {
            if (capture.name === 'script') return '<script>';
            if (capture.name === 'style') return '<style>';
            // 处理 id 和 class
            const attr = capture.node.parent;
            return attr.text;
        }
    },
    css: {
        id: 'css',
        wasm: getWasmPath('css'),
        extensions: ['css', 'scss', 'less'], // 扩展支持 SCSS/LESS (虽然解析器是 CSS，但基本兼容选择器)
        query: `
            (class_selector) @def 
            (id_selector) @def
            (tag_name) @tag
        `,
        formatter: (capture, text) => {
             if (capture.name === 'tag') return null; // 忽略纯标签选择器以减少噪音
             return text;
        }
    },

    // --- Backend & Systems ---

    python: {
        id: 'python',
        wasm: getWasmPath('python'),
        extensions: ['py'],
        query: `
            (function_definition name: (identifier) @name) @def
            (class_definition name: (identifier) @name) @def
            (decorated_definition (function_definition name: (identifier) @name)) @def
            (decorated_definition (class_definition name: (identifier) @name)) @def
        `,
        formatter: standardFormatter('py')
    },
    go: {
        id: 'go',
        wasm: getWasmPath('go'),
        extensions: ['go'],
        query: `
            (function_declaration name: (identifier) @name) @def
            (method_declaration name: (field_identifier) @name) @def
            (type_declaration (type_specifier name: (type_identifier) @name)) @def
        `,
        formatter: standardFormatter('go')
    },
    java: {
        id: 'java',
        wasm: getWasmPath('java'),
        extensions: ['java'],
        query: `
            (class_declaration name: (identifier) @name) @def
            (interface_declaration name: (identifier) @name) @def
            (record_declaration name: (identifier) @name) @def
            (method_declaration name: (identifier) @name) @def
            (constructor_declaration name: (identifier) @name) @def
        `,
        formatter: standardFormatter('java')
    },
    rust: {
        id: 'rust',
        wasm: getWasmPath('rust'),
        extensions: ['rs'],
        query: `
            (function_item name: (identifier) @name) @def
            (struct_item name: (type_identifier) @name) @def
            (trait_item name: (type_identifier) @name) @def
            (impl_item type: (type_identifier) @name) @def
            (macro_definition name: (identifier) @name) @def
        `,
        formatter: standardFormatter('rs')
    },
    cpp: {
        id: 'cpp',
        wasm: getWasmPath('cpp'),
        extensions: ['cpp', 'cxx', 'cc', 'c', 'h', 'hpp'],
        query: `
            (function_definition declarator: (function_declarator declarator: (identifier) @name)) @def
            (class_specifier name: (type_identifier) @name) @def
            (struct_specifier name: (type_identifier) @name) @def
            (namespace_definition name: (identifier) @name) @def
        `,
        formatter: standardFormatter('cpp')
    },
    
    // --- Config & Data ---
    
    json: {
        id: 'json',
        wasm: getWasmPath('json'),
        extensions: ['json'],
        query: `
            (pair key: (string) @name) @def
        `,
        formatter: (capture, text) => {
            // 只保留顶层或关键的 key，防止 map 过大
            return capture.name === 'name' ? text : null;
        }
    },
    yaml: {
        id: 'yaml',
        wasm: getWasmPath('yaml'),
        extensions: ['yaml', 'yml'],
        query: `
            (block_mapping_pair key: (flow_node) @name) @def
        `,
        formatter: (capture, text) => `${text}:`
    },

    c_sharp: {
        id: 'c_sharp',
        wasm: `${TS_BASE_URL}/tree-sitter-c-sharp.wasm`,
        extensions: ['cs'],
        query: `
            (class_declaration name: (identifier) @name) @def
            (interface_declaration name: (identifier) @name) @def
            (struct_declaration name: (identifier) @name) @def
            (enum_declaration name: (identifier) @name) @def
            (method_declaration name: (identifier) @name) @def
            (property_declaration name: (identifier) @name) @def
        `,
        formatter: standardFormatter('cs')
    },
    kotlin: {
        id: 'kotlin',
        wasm: getWasmPath('kotlin'),
        extensions: ['kt', 'kts'],
        query: `
            (class_declaration name: (type_identifier) @name) @def
            (object_declaration name: (type_identifier) @name) @def
            (function_declaration name: (simple_identifier) @name) @def
            (property_declaration name: (property_delegate) @name) @def
        `,
        formatter: standardFormatter('kt')
    },
    swift: {
        id: 'swift',
        wasm: getWasmPath('swift'),
        extensions: ['swift'],
        query: `
            (class_declaration name: (type_identifier) @name) @def
            (protocol_declaration name: (type_identifier) @name) @def
            (extension_declaration (type_identifier) @name) @def
            (function_declaration name: (simple_identifier) @name) @def
            (variable_declaration (pattern (simple_identifier) @name)) @def
        `,
        formatter: standardFormatter('swift')
    },

    // --- Web Backend (Classic) ---

    php: {
        id: 'php',
        wasm: getWasmPath('php'),
        extensions: ['php'],
        query: `
            (class_declaration name: (name) @name) @def
            (interface_declaration name: (name) @name) @def
            (trait_declaration name: (name) @name) @def
            (method_declaration name: (name) @name) @def
            (function_definition name: (name) @name) @def
        `,
        formatter: (capture, text) => {
             // PHP 变量通常带 $，保留它有助于 AI 识别
             return `php ${text}`;
        }
    },
    ruby: {
        id: 'ruby',
        wasm: getWasmPath('ruby'),
        extensions: ['rb', 'erb', 'rake', 'gemspec'],
        query: `
            (class name: (constant) @name) @def
            (module name: (constant) @name) @def
            (method name: (identifier) @name) @def
            (singleton_method name: (identifier) @name) @def
        `,
        formatter: standardFormatter('rb')
    },

    // --- Scripts & Configs (Crucial for Context) ---

    bash: {
        id: 'bash',
        wasm: getWasmPath('bash'),
        extensions: ['sh', 'bash', 'zsh'],
        query: `
            (function_definition name: (word) @name) @def
            (variable_assignment name: (variable_name) @name) @def
        `,
        formatter: (capture, text) => {
            if (capture.name === 'name') return null;
            return `sh ${text}`;
        }
    },
    lua: {
        id: 'lua', // 常见于游戏开发和 Neovim 配置
        wasm: getWasmPath('lua'),
        extensions: ['lua'],
        query: `
            (function_declaration name: [(identifier) (dot_index_expression)] @name) @def
            (variable_declaration (assignment_statement (variable_list name: (identifier) @name))) @def
        `,
        formatter: standardFormatter('lua')
    },
    toml: {
        id: 'toml', // Rust (Cargo.toml) 和 Python (pyproject.toml) 必用
        wasm: getWasmPath('toml'),
        extensions: ['toml'],
        query: `
            (table_header (key) @name) @def
            (pair key: (key) @name) @def
        `,
        formatter: (capture, text) => {
            // 只提取表头 [Section] 和关键 Key，避免提取所有值
            if (text.startsWith('[')) return text;
            return null; // 忽略普通键值对，防止 Map 过大
        }
    },
    dart: {
        id: 'dart', // Flutter
        wasm: getWasmPath('dart'),
        extensions: ['dart'],
        query: `
            (class_definition name: (identifier) @name) @def
            (enum_declaration name: (identifier) @name) @def
            (function_signature name: (identifier) @name) @def
            (method_signature name: (identifier) @name) @def
        `,
        formatter: standardFormatter('dart')
    },
    vue: {
        id: 'vue',
        wasm: getWasmPath('vue'),
        extensions: ['vue'],
        // 尝试捕获 script 标签内的顶层 export 或 setup 内容
        // 注意：Vue 的 tree-sitter 结构比较复杂，这里退而求其次提取 script 标签
        // 并通过 formatter 提示 AI 这是一个 Vue 组件
        query: `
            (script_element) @script
            (style_element) @style
        `,
        formatter: (capture, text) => {
            if (capture.name === 'script') {
                // 尝试提取 setup 或 export default 的简略信息
                const firstLine = text.trim().split('\n')[0];
                return `vue-script: ${firstLine.replace(/<script\s+/, '').replace(/>$/, '')}`;
            }
            if (capture.name === 'style') return 'vue-style';
            return null;
        }
    }
};