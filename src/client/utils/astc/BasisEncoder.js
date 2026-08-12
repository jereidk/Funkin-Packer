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
 * Output format: encode() returns a plain astcenc-format .astc file (see
 * AstcFile.js) - the encoder library itself only produces a KTX2 container,
 * which gets unwrapped to the raw ASTC block stream before returning. The
 * original KTX2 bytes are still available on the result as `.ktx2` if ever
 * needed, but `.astc` is what every consumer in this codebase uses.
 *
 * Reference: https://github.com/BinomialLLC/basis_universal
 */

import AstcFile from './AstcFile.js';

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

            // The glue code is Emscripten's UMD-style output: `var BASIS = (...)();`
            // followed by `if (typeof exports===...) {...} else if (typeof define===...) {...}`
            // with no plain `else` for the browser-global case it actually needs here.
            // In a browser with neither CommonJS nor AMD, neither branch runs, so the
            // script's last evaluated statement - and therefore eval(jsCode)'s result -
            // is `undefined`, not the factory. Worse, this file is an ES module (always
            // strict mode), where a direct eval's own `var` declarations don't leak into
            // the enclosing scope either, so even referencing a bare `BASIS` afterward
            // wouldn't work. `new Function` bodies run non-strict by default regardless
            // of the caller's mode, so appending an explicit return makes the `var BASIS`
            // inside resolve correctly.
            const basisFactory = new Function(jsCode + '\nreturn BASIS;')();
            
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

        // This prebuilt basis_encoder.wasm binary has a hard internal limit on
        // total pixel count, independent of aspect ratio - bisected directly
        // against the actual .wasm: 2048x2048 (4,194,304 px) succeeds, anything
        // above it fails, and a 4096x1024 image (the same total pixel count as
        // 2048x2048) also succeeds while a narrower 2200x1000 image (fewer total
        // pixels but width > 2048) also succeeds - so it's specifically total
        // pixels, not either dimension alone. There's no source available to
        // rebuild this .wasm with a higher limit, so the only thing to do is
        // fail fast and clearly instead of spending a real encode attempt (and
        // logging an opaque "encode() returned 0") only to fall back anyway -
        // reported directly: a 3779x3323 (12.6MP) export hit exactly this.
        const MAX_TOTAL_PIXELS = 2048 * 2048;
        if (width * height > MAX_TOTAL_PIXELS) {
            throw new Error(
                `BasisEncoder: ${width}x${height} (${(width * height / 1e6).toFixed(1)}MP) exceeds this WASM ` +
                `build's ~4.2MP total pixel limit (independent of aspect ratio) - falling back to the JS encoder`
            );
        }

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

            // Configure KTX2 output. Supercompression stays OFF: the real consumer
            // here (see AstcFile.js) reads the raw ASTC block stream straight out
            // of the KTX2 level data - turning this on would Zstd-compress that
            // data, and the caller has no decompressor for it.
            encoder.setCreateKTX2File(true);
            encoder.setKTX2UASTCSupercompression(false);

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

            console.log(`[BasisEncoder] Encoded ${ktx2Size} bytes (KTX2 container)`);

            // Clean up encoder
            encoder.delete();
            this.encoder = null;

            // The real consumer wants a plain astcenc-format .astc file (16-byte
            // header + raw blocks), not a KTX2 container - see AstcFile.js for why.
            // The KTX2 wrapper only exists here as a byproduct of how the encoder
            // library is driven; unwrap it before handing data back to the caller.
            const level0 = AstcFile.extractLevel0FromKtx2(ktx2Data);
            const astcData = AstcFile.wrapRawBlocks(level0.blockBytes, level0.width, level0.height, blockSize);

            console.log(`[BasisEncoder] Unwrapped to ${astcData.length} byte .astc file`);

            return {
                astc: astcData,
                ktx2: ktx2Data,
                size: astcData.length,
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
