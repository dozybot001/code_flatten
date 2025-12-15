/**
 * Configuration Layer
 * Contains static configuration, constants, and ignore lists.
 * This file allows easy modification without touching logic or UI code.
 */
const APP_CONFIG = {
    // Repository URL for the README sidebar
    REPO_README_URL: "./README.md",

    // Folders to ignore during scanning
    IGNORE_DIRS: [
        '.git', '.svn', '.hg', '.idea', '.vscode', '.settings',
        'node_modules', 'bower_components', 'build', 'dist', 'out', 'target',
        '__pycache__', '.venv', 'venv', 'env', '.pytest_cache',
        '.dart_tool', '.pub-cache', 'bin', 'obj', '.gradle', 'vendor',
        'tmp', 'temp', 'logs', 'coverage', '.next', '.nuxt',
        'ios', 'android'
    ],

    // File extensions to ignore (binary files, media, large docs, locks)
    IGNORE_EXTS: [
        '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.mp4', '.mp3', '.wav',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.tar', '.gz', '.7z', '.rar',
        '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.db', '.sqlite', '.sqlite3',
        '.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store'
    ],

    // Max file size to process (1MB) to prevent browser crash
    MAX_FILE_SIZE: 1024 * 1024
};