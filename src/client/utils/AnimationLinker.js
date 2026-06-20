/**
 * AnimationLinker - Preserves Animation.json metadata during atlas operations
 * 
 * This module handles the relationship between spritemap (sprite rectangles)
 * and Animation.json (timeline/symbol data) from Adobe Animate / Better TA.
 * 
 * When re-packing an atlas:
 * 1. The spritemap's x,y,w,h coordinates may change
 * 2. The Animation.json references sprites by NAME, not by position
 * 3. As long as sprite names remain the same, Animation.json stays valid
 * 
 * This module ensures:
 * - Animation.json is preserved unchanged when sprite names don't change
 * - Sprite name changes are tracked and can warn users
 * - Multi-atlas references are handled correctly
 */

class AnimationLinker {
    constructor() {
        this.animationData = null;
        this.spriteReferences = new Map(); // spriteName -> Set of locations in Animation.json
        this.symbolDefinitions = new Set(); // All symbol names defined in SD
        this.loaded = false;
    }

    /**
     * Load Animation.json data
     * @param {object|string} data - Parsed JSON or raw string
     */
    loadAnimation(data) {
        try {
            this.animationData = typeof data === 'string' ? JSON.parse(data) : data;
            this.buildSpriteReferenceMap();
            this.loaded = true;
            return true;
        } catch (e) {
            console.error('AnimationLinker: Failed to load Animation.json', e);
            this.loaded = false;
            return false;
        }
    }

    /**
     * Build a map of all sprite references within Animation.json
     * This allows us to track which sprites are actually used in the animation
     */
    buildSpriteReferenceMap() {
        this.spriteReferences.clear();
        this.symbolDefinitions.clear();

        if (!this.animationData) return;

        // Extract all symbol definitions from SD
        if (this.animationData.SD && this.animationData.SD.S) {
            for (let symbol of this.animationData.SD.S) {
                if (symbol.SN) {
                    this.symbolDefinitions.add(symbol.SN);
                }
            }
        }

        // Walk through the animation tree to find ASI (Atlas Sprite Instance) references
        this.walkForSpriteReferences(this.animationData);
    }

    /**
     * Recursively walk the animation structure to find sprite and symbol references
     */
    walkForSpriteReferences(node, path = '') {
        if (!node || typeof node !== 'object') return;

        // Check for ASI (Atlas Sprite Instance) - references a bitmap sprite by name
        if (node.ASI && node.ASI.N) {
            let spriteName = node.ASI.N;
            if (!this.spriteReferences.has(spriteName)) {
                this.spriteReferences.set(spriteName, []);
            }
            this.spriteReferences.get(spriteName).push({path, type: 'ASI'});
        }

        // Check for SI (Symbol Instance) - references a symbol by name
        if (node.SI && node.SI.SN) {
            let symbolName = node.SI.SN;
            if (!this.spriteReferences.has(symbolName)) {
                this.spriteReferences.set(symbolName, []);
            }
            this.spriteReferences.get(symbolName).push({path, type: 'SI'});
        }

        // Also check for SN directly at this level (some formats use this)
        if (node.SN && typeof node.SN === 'string') {
            let name = node.SN;
            if (!this.spriteReferences.has(name)) {
                this.spriteReferences.set(name, []);
            }
            this.spriteReferences.get(name).push({path, type: 'SN'});
        }

        // Recursively check arrays
        if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i++) {
                this.walkForSpriteReferences(node[i], `${path}[${i}]`);
            }
        }

        // Recursively check objects
        for (let key in node) {
            if (node.hasOwnProperty(key)) {
                this.walkForSpriteReferences(node[key], `${path}.${key}`);
            }
        }
    }

    /**
     * Check if a name is referenced in the animation
     */
    isReferenced(name) {
        return this.spriteReferences.has(name);
    }

    /**
     * Get all referenced names (both sprites and symbols)
     */
    getReferencedNames() {
        return Array.from(this.spriteReferences.keys());
    }

    /**
     * Get referenced sprite names (ASI type only - actual bitmap sprites)
     */
    getReferencedSprites() {
        let sprites = [];
        for (let [name, refs] of this.spriteReferences) {
            // Only include ASI references (actual bitmap sprites, not symbol names)
            if (refs.some(r => r.type === 'ASI')) {
                sprites.push(name);
            }
        }
        return sprites;
    }

    /**
     * Get referenced symbol names (SI type only - symbol instances)
     */
    getReferencedSymbols() {
        let symbols = [];
        for (let [name, refs] of this.spriteReferences) {
            // Only include SI references (symbol instances)
            if (refs.some(r => r.type === 'SI')) {
                symbols.push(name);
            }
        }
        return symbols;
    }

    /**
     * Get symbol reference counts - returns actual occurrence count per symbol
     * Returns: Map<symbolName, count> where count is the real number of SI references
     */
    getSymbolReferenceCounts() {
        const counts = new Map();
        for (let [name, refs] of this.spriteReferences) {
            // Count only SI (Symbol Instance) references
            const siCount = refs.filter(r => r.type === 'SI').length;
            if (siCount > 0) {
                counts.set(name, siCount);
            }
        }
        return counts;
    }

    /**
     * Get unreferenced sprites (sprites in atlas but not used in animation)
     */
    getUnreferencedSprites(allSprites) {
        let referenced = this.getReferencedSprites();
        return allSprites.filter(s => !referenced.includes(s.name || s));
    }

    /**
     * Check for orphaned references (sprites removed but still referenced)
     * Returns sprites and symbols that are referenced but don't exist
     */
    validateExistence(sprites) {
        let spriteNames = new Set(sprites.map(s => s.name || s));
        let orphanedSprites = [];
        let orphanedSymbols = [];

        for (let [name, refs] of this.spriteReferences) {
            if (!spriteNames.has(name)) {
                // Check if this is a sprite or symbol reference
                let isSpriteRef = refs.some(r => r.type === 'ASI' || r.type === 'SN');
                let isSymbolRef = refs.some(r => r.type === 'SI');
                
                if (isSpriteRef && !isSymbolRef) {
                    orphanedSprites.push({name, locations: refs});
                } else if (isSymbolRef) {
                    orphanedSymbols.push({name, locations: refs});
                } else {
                    // Unknown type, include in both
                    orphanedSprites.push({name, locations: refs});
                    orphanedSymbols.push({name, locations: refs});
                }
            }
        }

        return {
            sprites: orphanedSprites,
            symbols: orphanedSymbols,
            total: orphanedSprites.length + orphanedSymbols.length
        };
    }

    /**
     * Check if Animation.json is loaded
     */
    isLoaded() {
        return this.loaded && this.animationData !== null;
    }

    /**
     * Get the animation metadata (MD block)
     */
    getMetadata() {
        return this.animationData?.MD || null;
    }

    /**
     * Get animation data for export
     * Returns the Animation.json content unchanged
     */
    getAnimationData() {
        return this.animationData;
    }

    /**
     * Serialize animation data back to JSON string
     */
    toJSON() {
        return JSON.stringify(this.animationData, null, 2);
    }

    /**
     * Clear loaded animation data
     */
    clear() {
        this.animationData = null;
        this.spriteReferences.clear();
        this.symbolDefinitions.clear();
        this.loaded = false;
    }

    /**
     * Check if a filename looks like an Animation.json file
     */
    static isAnimationFile(filename) {
        if (!filename) return false;
        let lower = filename.toLowerCase();
        return lower.endsWith('animation.json') || 
               lower.includes('animation.json');
    }

    /**
     * Find Animation.json alongside a spritemap file
     */
    static findAnimationFile(filename) {
        if (!filename) return null;
        
        // Pattern: spritemap1.json -> spritemap1Animation.json
        let base = filename.replace(/\.json$/i, '');
        let animFile = base + 'Animation.json';
        
        return animFile;
    }
}

// Singleton instance for global access
let animationLinker = null;

export function getAnimationLinker() {
    if (!animationLinker) {
        animationLinker = new AnimationLinker();
    }
    return animationLinker;
}

export function createAnimationLinker() {
    return new AnimationLinker();
}

export default AnimationLinker;
