import { Observer, GLOBAL_EVENT } from './Observer';
import PackProcessor from './PackProcessor';
import TextureRenderer from './utils/TextureRenderer';
import { getFilterByType } from './filters';
import I18 from './utils/I18';
import { startExporter, startBetterTAExporter } from './exporters';
import { getAnimationLinker } from './utils/AnimationLinker';
import { generateAnimationJsonString, getAnimationPreview } from './utils/AnimationBuilder';
import { getOptions as getAnimOptions, getGenerateAnimation } from './store/animationOptionsStore';
// ASTC real: Use BasisEncoder (Basis Universal WASM) instead of ASTCEncoder (simulated)
import basisEncoder from './utils/astc/BasisEncoder';
// Keep ASTCEncoder as fallback
import astcEncoderFallback from './utils/astc/ASTCEncoder';
//import Tinifyer from 'platform/Tinifyer';
import Downloader from 'platform/Downloader';
// PNG compression
import { compressPngFromCanvas } from './utils/PngCompressor';

// Idempotent polyfill at module scope - HMR-safe with configurable: true
if (!HTMLImageElement.prototype.hasOwnProperty('__fpToDataURL')) {
    Object.defineProperty(HTMLImageElement.prototype, '__fpToDataURL', { value: true, configurable: true, writable: true });
    Object.defineProperty(HTMLImageElement.prototype, 'toDataURL', {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function(m, q) {
            let c = document.createElement('canvas');
            c.width = this.naturalWidth; c.height = this.naturalHeight;
            c.getContext('2d').drawImage(this, 0, 0); 
            return c.toDataURL(m, q);
        }
    });
}

let INSTANCE = null;

class APP {

    constructor() {
        INSTANCE = this;

        this.images = {};
        this.packOptions = {};
        this.packResult = null;

        this.onPackComplete = this.onPackComplete.bind(this);
        this.onPackError = this.onPackError.bind(this);

        Observer.on(GLOBAL_EVENT.IMAGES_LIST_CHANGED, this.onImagesListChanged, this);
        Observer.on(GLOBAL_EVENT.PACK_OPTIONS_CHANGED, this.onPackOptionsChanged, this);
        Observer.on(GLOBAL_EVENT.PACK_EXPORTER_CHANGED, this.onPackExporterOptionsChanged, this);
        Observer.on(GLOBAL_EVENT.START_EXPORT, this.startExport, this);
    }

    static get i() {
        return INSTANCE;
    }

    onImagesListChanged(data) {
        this.images = data;
        this.pack();
    }

    onPackOptionsChanged(data) {
        this.packOptions = data;
        this.pack();
    }

    onPackExporterOptionsChanged(data) {
        this.packOptions = data;
    }

    pack() {
        let keys = Object.keys(this.images);

        if (keys.length > 0) {
            Observer.emit(GLOBAL_EVENT.SHOW_SHADER);
            setTimeout(() => this.doPack(), 0);
        }
        else {
            this.doPack();
        }
    }

    doPack() {
        PackProcessor.pack(this.images, this.packOptions, this.onPackComplete, this.onPackError);
    }

    onPackComplete(res) {
        this.packResult = [];

        for (let data of res) {
            let renderer = new TextureRenderer(data, this.packOptions);

            this.packResult.push({
                data: data,
                buffer: renderer.buffer,
                renderer: renderer
            });
        }

        Observer.emit(GLOBAL_EVENT.PACK_COMPLETE, this.packResult);
        Observer.emit(GLOBAL_EVENT.HIDE_SHADER);
    }

    onPackError(err) {
        Observer.emit(GLOBAL_EVENT.HIDE_SHADER);
        Observer.emit(GLOBAL_EVENT.SHOW_MESSAGE, err.description);
    }

    startExport() {
        if (!this.packResult || !this.packResult.length) {
            Observer.emit(GLOBAL_EVENT.SHOW_MESSAGE, I18.f("NO_IMAGES_ERROR"));
            return;
        }

        //if (this.packOptions.tinify && !this.packOptions.tinifyKey) {
        //    Observer.emit(GLOBAL_EVENT.SHOW_MESSAGE, I18.f("NO_TINIFY_KEY_ERROR"));
        //    return;
        //}

        Observer.emit(GLOBAL_EVENT.SHOW_SHADER);
        setTimeout(() => this.doExport(), 0);
    }

    async doExport() {
        let exporter = this.packOptions.exporter;
        let textureName = this.packOptions.textureName;
        let filterClass = getFilterByType(this.packOptions.filter);
        let filter = new filterClass();

        let files = [];

        let ix = 0;
        for (let item of this.packResult) {

            let fName = textureName + (this.packResult.length > 1 ? "-" + ix : "");

            let buffer = item.renderer.scale(this.packOptions.scale);

            let imageData;
            let astcMeta = null;

            if (this.packOptions.textureFormat === 'astc') {
                // Generate ASTC texture using Basis Universal WASM encoder
                const canvas = filter.apply(buffer);
                const ctx = canvas.getContext('2d');
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

                // Get ASTC options from packOptions (with defaults)
                const astcOptions = {
                    blockSize: this.packOptions.astcBlockSize || '4x4',
                    quality: this.packOptions.astcQuality || 'medium',
                    colorProfile: this.packOptions.astcColorProfile || 'ldr-rgba'
                };

                // Try real Basis Universal encoder first
                let astcData;
                try {
                    if (basisEncoder.isReady()) {
                        console.log('[APP] Using Basis Universal WASM encoder');
                        const result = await basisEncoder.encode(imgData, astcOptions);
                        astcData = result.ktx2; // KTX2 container with ASTC data
                    } else {
                        // Initialize encoder if needed
                        console.log('[APP] Initializing Basis Universal encoder...');
                        const ready = await basisEncoder.initialize();
                        if (ready) {
                            console.log('[APP] Using Basis Universal WASM encoder');
                            const result = await basisEncoder.encode(imgData, astcOptions);
                            astcData = result.ktx2;
                        } else {
                            throw new Error('BasisEncoder init failed');
                        }
                    }
                } catch (e) {
                    // Fallback to simulated encoder
                    console.warn('[APP] Basis encoder failed, using fallback:', e.message);
                    astcData = await astcEncoderFallback.encode(imgData, astcOptions);
                }

                // Store ASTC data as binary (will be converted to base64)
                imageData = astcData;
                astcMeta = {
                    blockSize: astcOptions.blockSize,
                    width: canvas.width,
                    height: canvas.height
                };
            } else if (this.packOptions.textureFormat === "png" && this.packOptions.compressPng) {
                // Use PNG compression if enabled
                const pngCanvas = filter.apply(buffer);
                const compressOptions = {
                    quality: this.packOptions.compressPngQuality || 0.8,
                    stripMetadata: this.packOptions.compressPngStripMeta || false
                };
                
                // Compress PNG and get base64 result
                console.log('[APP] Compressing PNG with options:', compressOptions);
                const compressedData = await compressPngFromCanvas(pngCanvas, 'texture.png', compressOptions);
                
                // Convert Uint8Array to base64
                imageData = btoa(String.fromCharCode(...compressedData));
                console.log(`[APP] PNG compressed successfully, output size: ${imageData.length} bytes`);
            } else {
                imageData = filter.apply(buffer).toDataURL(this.packOptions.textureFormat === "png" ? "image/png" : "image/jpeg");
                let parts = imageData.split(",");
                parts.shift();
                imageData = parts.join(",");
            }

            /*try {
                imageData = await Tinifyer.start(imageData, this.packOptions);
            }
            catch (e) {
                Observer.emit(GLOBAL_EVENT.HIDE_SHADER);
                Observer.emit(GLOBAL_EVENT.SHOW_MESSAGE, e);
                return;
            }*/

            if (this.packOptions.textureFormat === 'astc') {
                // Convert ASTC binary to base64 for correct ZIP storage
                const astcBytes = imageData instanceof Uint8Array ? imageData : new Uint8Array(imageData);
                const astcBinary = String.fromCharCode(...astcBytes);
                files.push({
                    name: `${fName}.astc`,
                    content: btoa(astcBinary),
                    base64: true,
                    astcMeta: astcMeta
                });
            } else {
                files.push({
                    name: `${fName}.${this.packOptions.textureFormat}`,
                    content: imageData,
                    base64: true
                });
            }

            // Determine pixel format based on texture format and block size
            let pixelFormat;
            if (this.packOptions.textureFormat === "png") {
                pixelFormat = "RGBA8888";
            } else if (this.packOptions.textureFormat === "astc") {
                // Use actual block size from ASTC options, default to 4x4
                const blockSize = this.packOptions.astcBlockSize || '4x4';
                pixelFormat = `ASTC_${blockSize}`;
            } else {
                pixelFormat = "RGB888";
            }

            let options = {
                imageName: `${fName}`,
                imageFile: `${fName}.${this.packOptions.textureFormat === 'astc' ? 'astc' : this.packOptions.textureFormat}`,
                imageData: this.packOptions.textureFormat === 'astc' ? undefined : imageData,
                format: pixelFormat,
                textureFormat: this.packOptions.textureFormat,
                imageWidth: buffer.width,
                imageHeight: buffer.height,
                removeFileExtension: this.packOptions.removeFileExtension,
                prependFolderName: this.packOptions.prependFolderName,
                base64Export: this.packOptions.base64Export,
                scale: this.packOptions.scale,
                trimMode: this.packOptions.trimMode,

                sortExportedRows: this.packOptions.sortExportedRows,
            };

            try {
                // Check if this is the BetterTA exporter
                if (exporter.type === "BetterTA (Atlas)") {
                    // Use BetterTA exporter which generates Atlas.json
                    let betterTAOutput = await startBetterTAExporter(exporter, item.data, options);
                    files.push({
                        name: betterTAOutput.atlas.name,
                        content: betterTAOutput.atlas.content
                    });
                    
                    let animLinker = getAnimationLinker();
                    let animOptions = getAnimOptions();
                    
                    // Determine what to do with Animation.json
                    if (animLinker.isLoaded()) {
                        // Case 1: Preserve existing Animation.json
                        // Get all sprite names from the packed result
                        let spriteNames = item.data.map(d => d.name || d.originalFile || '');
                        
                        // Validate sprite existence in animation
                        let validation = animLinker.validateExistence(spriteNames);
                        
                        if (validation.total > 0) {
                            let warnings = [];
                            if (validation.sprites.length > 0) warnings.push(validation.sprites.length + ' sprites');
                            if (validation.symbols.length > 0) warnings.push(validation.symbols.length + ' symbols');
                            console.warn('BetterTA: Animation references may be broken — ' + warnings.join(', ') + ' not found in atlas. Consider keeping original sprite names.');
                        }
                        
                        // Log reference stats
                        let refSprites = animLinker.getReferencedSprites();
                        let refSymbols = animLinker.getReferencedSymbols();
                        console.log('BetterTA: Animation.json preserved', 
                            '(sprites:', refSprites.length, 
                            '| symbols:', refSymbols.length + ')');
                        
                        files.push({
                            name: betterTAOutput.animation.name,
                            content: animLinker.toJSON()
                        });
                    } else if (getGenerateAnimation()) {
                        // Case 2: Generate new Animation.json from sprite names (opt-in)
                        let animationContent = generateAnimationJsonString(item.data, {
                            fps: animOptions.fps,
                            canvasWidth: animOptions.canvasWidth,
                            canvasHeight: animOptions.canvasHeight,
                            backgroundColor: animOptions.backgroundColor
                        });
                        
                        // Show preview info
                        let preview = getAnimationPreview(item.data);
                        console.log('BetterTA: Generated Animation.json with', preview.length, 'symbols:', 
                            preview.map(p => p.symbolName + '(' + p.frameCount + 'frames)').join(', '));
                        
                        files.push({
                            name: betterTAOutput.animation.name,
                            content: animationContent
                        });
                    }
                    // Case 3: No Animation.json (user didn't load one and didn't opt-in to generate)
                    // Don't export any Animation.json
                } else {
                    // Standard exporter
                    files.push({
                        name: fName + "." + this.packOptions.exporter.fileExt,
                        content: await startExporter(exporter, item.data, options)
                    });
                }
            }
            catch (e) {
                Observer.emit(GLOBAL_EVENT.HIDE_SHADER);
                Observer.emit(GLOBAL_EVENT.SHOW_MESSAGE, I18.f("EXPORTER_ERROR", e));
                return;
            }

            ix++;
        }

        try {
            await Downloader.run(files, this.packOptions.fileName, this.packOptions.savePath);
        } catch (e) {
            Observer.emit(GLOBAL_EVENT.HIDE_SHADER);
            Observer.emit(GLOBAL_EVENT.SHOW_MESSAGE, I18.f("DOWNLOAD_ERROR", e));
            return;
        }
        Observer.emit(GLOBAL_EVENT.HIDE_SHADER);
    }
}

export default APP;