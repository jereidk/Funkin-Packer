/**
 * BasisEncoder - Real Basis Universal WebAssembly encoder for Washos Packer
 * 
 * Uses the official pre-built Basis Universal encoder from BinomialLLC/basis_universal
 * (webgl/encoder/build/) which provides genuine texture compression.
 * 
 * IMPORTANT: The glue code (basis_encoder.js) and WASM binary are loaded via fetch()
 * from the resources directory to avoid webpack bundling issues with the Emscripten
 * generated code that contains Node.js specific requires.
 * 
 * Output format: KTX2 container with UASTC/ETC1S/Basis compressed data.
 * 
 * Reference: https://github.com/BinomialLLC/basis_universal
 */

// Block size to ASTC format mapping (confirmed with actual module inspection)
// Uses cASTC_LDR_* format names as exposed by Module.basis_tex_format
const BLOCK_FORMAT_MAP = {
    '4x4': 'cASTC_LDR_4x4',
    '5x4': 'cASTC_LDR_5x4',
    '5x5': 'cASTC_LDR_5x5',
    '6x5': 'cASTC_LDR_6x5',
    '6x6': 'cASTC_LDR_6x6',
    '8x5': 'cASTC_LDR_8x5',
    '8x6': 'cASTC_LDR_8x6',
    '10x5': 'cASTC_LDR_10x5',
    '10x6': 'cASTC_LDR_10x6',
    '8x8': 'cASTC_LDR_8x8',
    '10x8': 'cASTC_LDR_10x8',
    '10x10': 'cASTC_LDR_10x10',
    '12x10': 'cASTC_LDR_12x10',
    '12x12': 'cASTC_LDR_12x12',
};

/**
 * BasisEncoder singleton class
 * Provides real texture compression via WebAssembly
 */
class BasisEncoder {
    constructor() {
        this.module = null;       // Emscripten Module instance
        this.encoder = null;     // BasisEncoder C++ wrapper
        this.ready = false;
        this.initializing = false;
        this.initPromise = null;
        this.baseUrl = '';       // Base URL for loading resources
    }

    /**
     * Set the base URL for loading WASM resources
     */
    setBaseUrl(url) {
        this.baseUrl = url;
    }

    /**
     * Initialize the WASM module - loads and instantiates basis_encoder.wasm
     * @returns {Promise<boolean>}
     */
    async initialize() {
        if (this.ready) return true;
        if (this.initializing) return this.initPromise;

        this.initializing = true;
        this.initPromise = this._doInitialize();
        return this.initPromise;
    }

    async _doInitialize() {
        try {
            console.log('[BasisEncoder] Loading Basis Universal WASM encoder...');
            
            // Determine base URL for resources
            const baseUrl = this.baseUrl || this._getBaseUrl();
            
            // Load the WASM binary first
            const wasmResponse = await fetch(baseUrl + 'basis_encoder.wasm');
            if (!wasmResponse.ok) {
                throw new Error(`Failed to fetch basis_encoder.wasm: ${wasmResponse.status}`);
            }
            const wasmBinary = await wasmResponse.arrayBuffer();

            // Load the glue code
            const jsResponse = await fetch(baseUrl + 'basis_encoder.js');
            if (!jsResponse.ok) {
                throw new Error(`Failed to fetch basis_encoder.js: ${jsResponse.status}`);
            }
            const jsCode = await jsResponse.text();

            // Execute the glue code in a function scope
            // The glue code is an IIFE that assigns BASIS to the local scope
            const basisFactory = eval(jsCode);
            
            // Create the Basis module with the WASM binary pre-loaded
            this.module = await basisFactory({
                wasmBinary: wasmBinary,
                locateFile: () => '' // We pre-loaded the binary
            });

            // Initialize the Basis encoder library
            if (this.module.initializeBasis) {
                this.module.initializeBasis();
            }

            this.ready = true;
            console.log('[BasisEncoder] WASM encoder loaded successfully');
            return true;
        } catch (error) {
            console.error('[BasisEncoder] Failed to load WASM encoder:', error);
            this.initializing = false;
            return false;
        }
    }

    _getBaseUrl() {
        // Try to determine the base URL from the current script or document
        if (typeof document !== 'undefined') {
            const scripts = document.getElementsByTagName('script');
            for (let i = scripts.length - 1; i >= 0; i--) {
                const src = scripts[i].src;
                if (src && src.includes('index.js')) {
                    // Extract base path from the script URL
                    return src.replace(/\/static\/js\/index\.js.*$/, '/');
                }
            }
            // Fallback to root
            return './';
        }
        return './';
    }

    /**
     * Encode RGBA image data to KTX2 compressed format
     * 
     * Compatible interface with ASTCEncoder.encode(imageData, options)
     * 
     * @param {ImageData|Uint8Array} imageData - RGBA image data (width*height*4 bytes)
     * @param {Object} options - Encoding options
     * @param {string} options.blockSize - Block size e.g. '4x4' (default: '4x4')
     * @param {number} options.quality - Quality level 1-255 (default: 128)
     * @param {boolean} options.sRGB - Use sRGB colorspace (default: true)
     * @returns {Promise<{ktx2: Uint8Array, size: number, width: number, height: number, blockSize: string}>}
     */
    async encode(imageData, options = {}) {
        // Handle ImageData format (extract raw RGBA data)
        let rawData;
        let width, height;
        
        if (imageData.data && imageData.width !== undefined) {
            // ImageData format
            rawData = imageData.data; // Uint8Array of RGBA pixels
            width = imageData.width;
            height = imageData.height;
        } else {
            throw new Error('BasisEncoder.encode: ImageData required with .data and .width properties');
        }

        if (options.width) width = options.width;
        if (options.height) height = options.height;

        const {
            blockSize = '4x4',
            quality = 128,
            sRGB = true,
        } = options;

        console.log(`[BasisEncoder] Encoding ${width}x${height} to ASTC ${blockSize}, quality=${quality}`);

        try {
            const Module = this.module;
            
            // Create the encoder instance
            const encoder = new Module.BasisEncoder();
            this.encoder = encoder;

            // Set source image data (RGBA, 4 bytes per pixel)
            // cRGBA32 is the correct enum for raw RGBA data
            const imageType = Module.ldr_image_type.cRGBA32.value;
            encoder.setSliceSourceImage(0, rawData, width, height, imageType);

            // Set output format to ASTC
            const formatName = BLOCK_FORMAT_MAP[blockSize];
            if (!formatName) {
                throw new Error(`Unsupported block size: ${blockSize}`);
            }
            const formatValue = Module.basis_tex_format[formatName]?.value;
            if (formatValue === undefined) {
                throw new Error(`Format ${formatName} not available in this build`);
            }
            encoder.setFormatMode(formatValue);

            // Configure KTX2 output
            encoder.setCreateKTX2File(true);
            encoder.setKTX2UASTCSupercompression(true);
            
            // Colorspace settings
            encoder.setPerceptual(sRGB);
            encoder.setKTX2AndBasisSRGBTransferFunc(sRGB);
            encoder.setMipSRGB(sRGB);

            // Quality level (1-255)
            encoder.setQualityLevel(quality);

            // Allocate output buffer for KTX2 data
            // Size: enough for worst case (24MB should cover 4096x4096 RGBA)
            const outputBuffer = new Uint8Array(1024 * 1024 * 24);

            // Encode! - returns actual bytes written
            const ktx2Size = encoder.encode(outputBuffer);
            
            if (ktx2Size <= 0) {
                throw new Error('BasisEncoder: encode() returned ' + ktx2Size);
            }

            // Extract the actual encoded data from the buffer
            const ktx2Data = outputBuffer.slice(0, ktx2Size);

            console.log(`[BasisEncoder] Encoded ${ktx2Size} bytes`);

            // Clean up encoder
            encoder.delete();
            this.encoder = null;

            return {
                ktx2: ktx2Data,
                size: ktx2Size,
                width,
                height,
                blockSize,
                format: `ASTC ${blockSize}`,
            };
        } catch (error) {
            console.error('[BasisEncoder] Encode error:', error);
            if (this.encoder) {
                try { this.encoder.delete(); } catch (_) {}
                this.encoder = null;
            }
            throw error;
        }
    }

    /**
     * Check if encoder is ready
     */
    isReady() {
        return this.ready;
    }

    /**
     * Get supported block sizes
     */
    getSupportedBlockSizes() {
        return Object.keys(BLOCK_FORMAT_MAP);
    }
}

// Export singleton instance
const basisEncoder = new BasisEncoder();

export default basisEncoder;
