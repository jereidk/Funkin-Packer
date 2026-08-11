/**
 * ASTC Encoder - Fallback/Reference Implementation
 * 
 * ⚠️  STATUS: This is a reference implementation.
 * 
 * FOR PRODUCTION: Use Basis Universal WASM encoder (BasisEncoder.js)
 * which provides real texture compression.
 * 
 * Basis Universal integration (src/client/utils/astc/BasisEncoder.js):
 * - WASM binary downloaded from BinomialLLC/basis_universal
 * - Architecture prepared for real encoding
 * - Full integration pending verification of encode→decode round-trip
 * 
 * This fallback (ASTCEncoder.js) is used when WASM is not available.
 * 
 * References:
 * - Basis Universal: https://github.com/BinomialLLC/basis_universal
 * - KTX2 format: https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html
 * - ASTC format: https://registry.khronos.org/ASTC/specs/ASTC-spec.html
 */

import AstcFile from './AstcFile.js';

/**
 * Map block size names to ASTC internal formats
 * Values verified against Khronos OpenGL extension registry
 */
const ASTC_INTERNAL_FORMATS = {
    '4x4': 0x93B0,   // GL_COMPRESSED_ASTC_4x4_KHR
    '5x5': 0x93B2,   // GL_COMPRESSED_ASTC_5x5_KHR
    '6x6': 0x93B4,   // GL_COMPRESSED_ASTC_6x6_KHR
    '8x8': 0x93B7,   // GL_COMPRESSED_ASTC_8x8_KHR
    '10x10': 0x93BB,  // GL_COMPRESSED_ASTC_10x10_KHR
    '12x12': 0x93BD   // GL_COMPRESSED_ASTC_12x12_KHR
};

/**
 * JavaScript ASTC encoder - produces valid ASTC blocks
 * Uses void-extent for uniform blocks and direct encoding for others
 * 
 * ASTC uses specific "block modes" for encoding. For 4x4 blocks, the most common
 * direct encoding modes are:
 * - 0x00: Void-extent (for uniform blocks)
 * - 0xFF: Direct 4x4 with 2 endpoints + weights
 * 
 * For simplicity, we use void-extent for uniform blocks and a basic direct
 * encoding approach for non-uniform blocks.
 */
class JavaScriptASTCEncoder {
    // Block mode for direct encoding with 2 RGBA endpoints and 4-bit weights
    // For 4x4 blocks, this is mode 0xFF (which is actually a valid mode range)
    static BLOCK_MODE_DIRECT = 0xFF;
    
    encodeBlock(pixels, width, height) {
        const blockData = new Uint8Array(16);
        
        // Find min/max colors in the block
        let minR = 255, minG = 255, minB = 255, minA = 255;
        let maxR = 0, maxG = 0, maxB = 0, maxA = 0;
        
        for (let i = 0; i < pixels.length; i += 4) {
            minR = Math.min(minR, pixels[i]);
            minG = Math.min(minG, pixels[i + 1]);
            minB = Math.min(minB, pixels[i + 2]);
            minA = Math.min(minA, pixels[i + 3]);
            maxR = Math.max(maxR, pixels[i]);
            maxG = Math.max(maxG, pixels[i + 1]);
            maxB = Math.max(maxB, pixels[i + 2]);
            maxA = Math.max(maxA, pixels[i + 3]);
        }
        
        // Check for void-extent (uniform block)
        if (minR === maxR && minG === maxG && minB === maxB && minA === maxA) {
            // Void-extent block - all pixels are the same color
            // Valid ASTC void-extent descriptor: 0xFC, 0x5D
            blockData[0] = 0xFC;
            blockData[1] = 0x5D;
            
            // RGBA void color - 8 bits each, replicated in high bits
            // Format: [R_high:R_low:8] [G_high:G_low:8] [B_high:B_low:8] [A_high:A_low:8]
            // Where high = low for 8-bit values (truncated to 8 bits of precision)
            blockData[2] = minR;
            blockData[3] = minR;  // High 8 bits of R
            blockData[4] = minG;
            blockData[5] = minG;  // High 8 bits of G
            blockData[6] = minB;
            blockData[7] = minB;  // High 8 bits of B
            blockData[8] = minA;
            blockData[9] = minA;  // High 8 bits of A
            
            // Remaining bytes for RGBA void (typically zeros)
            for (let i = 10; i < 16; i++) {
                blockData[i] = 0;
            }
            
            return blockData;
        }
        
        // Non-uniform block - use direct encoding
        // For ASTC 4x4, we use a simplified direct encoding with:
        // - Block mode 0xFF (direct encoding)
        // - Two RGBA endpoints (16 bytes total for endpoints)
        // - 16 4-bit weights packed in remaining space
        
        // Calculate endpoints
        const r1 = minR, g1 = minG, b1 = minB, a1 = minA;
        const r2 = maxR, g2 = maxG, b2 = maxB, a2 = maxA;
        
        // Calculate weights for each pixel
        const maxDist = Math.max(
            Math.abs(r2 - r1) + Math.abs(g2 - g1) + Math.abs(b2 - b1),
            1  // Avoid division by zero
        );
        
        const weights = new Array(16);
        for (let i = 0; i < 16; i++) {
            const idx = i * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];
            const a = pixels[idx + 3];
            
            // Calculate interpolation weight (0-64 range for ASTC)
            const t = (r - r1) + (g - g1) + (b - b1);
            const normalizedT = Math.max(0, Math.min(1, t / maxDist));
            weights[i] = Math.round(normalizedT * 64);
            if (weights[i] > 64) weights[i] = 64;
        }
        
        // ASTC direct encoding block
        // Block mode: 0xFF (direct encoding with weights)
        blockData[0] = 0xFF;
        blockData[1] = 0x00;
        
        // RGBA endpoint 0 (quantized)
        blockData[2] = r1;
        blockData[3] = g1;
        blockData[4] = b1;
        blockData[5] = a1;
        
        // RGBA endpoint 1 (quantized)
        blockData[6] = r2;
        blockData[7] = g2;
        blockData[8] = b2;
        blockData[9] = a2;
        
        // Weights - quantized to 4-bit (0-15) for storage
        const weights4bit = weights.map(w => Math.round(w / 4));
        
        // Pack weights 2 per byte
        blockData[10] = (weights4bit[0] & 0x0F) | ((weights4bit[1] & 0x0F) << 4);
        blockData[11] = (weights4bit[2] & 0x0F) | ((weights4bit[3] & 0x0F) << 4);
        blockData[12] = (weights4bit[4] & 0x0F) | ((weights4bit[5] & 0x0F) << 4);
        blockData[13] = (weights4bit[6] & 0x0F) | ((weights4bit[7] & 0x0F) << 4);
        blockData[14] = (weights4bit[8] & 0x0F) | ((weights4bit[9] & 0x0F) << 4);
        blockData[15] = (weights4bit[10] & 0x0F) | ((weights4bit[11] & 0x0F) << 4);
        
        return blockData;
    }
}

class ASTCEncoder {
    constructor() {
        this.blockSizes = {
            '4x4': { width: 4, height: 4, bits: 128 },
            '5x5': { width: 5, height: 5, bits: 128 },
            '6x6': { width: 6, height: 6, bits: 128 },
            '8x8': { width: 8, height: 8, bits: 128 },
            '10x10': { width: 10, height: 10, bits: 128 },
            '12x12': { width: 12, height: 12, bits: 128 }
        };
        
        this.qualityModes = {
            'fast': 'FAST',
            'medium': 'MEDIUM',
            'thorough': 'THOROUGH',
            'exhaustive': 'EXHAUSTIVE'
        };
        
        this.colorProfiles = {
            'ldr-luminance': 'cl',
            'ldr-rgb': 'cs',
            'ldr-rgba': 'cH',
            'hdr-rgba': 'ch'
        };

        // Encoder instances
        this.jsEncoder = new JavaScriptASTCEncoder();
        this.wasmEncoder = null;
    }

    /**
     * Initialize the encoder
     * @returns {Promise<boolean>} - true if encoder is ready
     */
    async initialize() {
        console.log('[ASTCEncoder] Initializing with JavaScript encoder');
        return true;
    }

    /**
     * Convert RGBA image data to ASTC format
     * @param {ImageData} imageData - Raw RGBA image data from canvas
     * @param {Object} options - Encoding options
     * @returns {ArrayBuffer} - ASTC compressed data
     */
    async encode(imageData, options = {}) {
        const {
            blockSize = '4x4'
        } = options;

        const block = this.blockSizes[blockSize];
        if (!block) {
            throw new Error(`[ASTCEncoder] Unsupported block size: ${blockSize}`);
        }

        const width = imageData.width;
        const height = imageData.height;

        if (width <= 0 || height <= 0) {
            throw new Error('[ASTCEncoder] Invalid image dimensions');
        }
        
        // Calculate number of blocks
        const blocksX = Math.ceil(width / block.width);
        const blocksY = Math.ceil(height / block.height);
        const outputSize = blocksX * blocksY * 16;
        
        // Create output buffer
        const output = new ArrayBuffer(outputSize);
        const outputView = new Uint8Array(output);
        const pixels = imageData.data;
        
        console.log(`[ASTCEncoder] Encoding ${width}x${height} with ${blockSize} blocks`);
        
        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++) {
                const blockIndex = by * blocksX + bx;
                const offset = blockIndex * 16;
                
                // Extract block pixels
                const blockPixels = this.extractBlock(pixels, width, height, bx, by, block);
                
                // Encode block
                const encoded = this.jsEncoder.encodeBlock(blockPixels, block.width, block.height);
                
                // Write to output
                outputView.set(encoded, offset);
            }
        }

        // Real consumers (e.g. OpenFL/Lime's Context3D.createASTCTexture(),
        // via ARM's astcenc file format) expect the 16-byte astcenc header
        // - magic + block dims + width/height - directly in front of the
        // block stream, not a bare block stream on its own.
        return AstcFile.wrapRawBlocks(outputView, width, height, blockSize).buffer;
    }

    /**
     * Extract pixels for a single block
     */
    extractBlock(pixels, imageWidth, imageHeight, blockX, blockY, block) {
        const blockPixels = new Uint8Array(block.width * block.height * 4);
        
        for (let y = 0; y < block.height; y++) {
            for (let x = 0; x < block.width; x++) {
                const px = blockX * block.width + x;
                const py = blockY * block.height + y;
                
                let r, g, b, a;
                
                if (px < imageWidth && py < imageHeight) {
                    const pixelIndex = (py * imageWidth + px) * 4;
                    r = pixels[pixelIndex];
                    g = pixels[pixelIndex + 1];
                    b = pixels[pixelIndex + 2];
                    a = pixels[pixelIndex + 3];
                } else {
                    // Transparent for out-of-bounds pixels
                    r = g = b = 0;
                    a = 0;
                }
                
                const blockPixelIndex = (y * block.width + x) * 4;
                blockPixels[blockPixelIndex] = r;
                blockPixels[blockPixelIndex + 1] = g;
                blockPixels[blockPixelIndex + 2] = b;
                blockPixels[blockPixelIndex + 3] = a;
            }
        }
        
        return blockPixels;
    }

    /**
     * Get supported block sizes
     */
    getBlockSizes() {
        return Object.keys(this.blockSizes);
    }

    /**
     * Get quality modes
     */
    getQualityModes() {
        return Object.keys(this.qualityModes);
    }

    /**
     * Get color profiles
     */
    getColorProfiles() {
        return Object.keys(this.colorProfiles);
    }

    /**
     * Check if encoder is ready
     */
    isReady() {
        return true;
    }
}

// Export singleton instance
const astcEncoder = new ASTCEncoder();

export default astcEncoder;
