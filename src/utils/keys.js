import { readFileSync } from 'fs';

let keys = {};
try {
    const data = readFileSync('./keys.json', 'utf8');
    keys = JSON.parse(data);
} catch (err) {
    console.warn('keys.json not found. Defaulting to environment variables.'); // still works with local models
}

export function getKey(name, index = 0) {
    if (name === 'GEMINI_API_KEY') {
        if (keys.GEMINI_API_KEYS && Array.isArray(keys.GEMINI_API_KEYS) && keys.GEMINI_API_KEYS.length > 0) {
            return keys.GEMINI_API_KEYS[index % keys.GEMINI_API_KEYS.length];
        }
        // Fallback for single key
        let key = keys[name] || process.env[name];
        if (key) return key;

        throw new Error('GEMINI_API_KEY not found. Please add "GEMINI_API_KEYS": ["key1", "key2"...] to keys.json');
    }
    throw new Error(`API key "${name}" is not supported. Only Gemini API keys are allowed.`);
}

export function hasKey(name) {
    if (name === 'GEMINI_API_KEY') return true;
    return false;
}
