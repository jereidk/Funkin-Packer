import React from 'react';
import JSZip from 'jszip';
import pako from 'pako';
import { compressPng as compressPngUtil } from '../utils/PngCompressor';

const LOG_PREFIX = '[ZipCompressor]';

class ZipAssetCompressor extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            isExpanded: false,
            isDragging: false,
            selectedFile: null,
            zipStructure: null,
            isProcessing: false,
            progress: 0,
            currentFile: '',
            result: null,
            errors: [],
            warnings: [],
            oggUnavailable: false,

            // Compression options
            compressAll: true,
            compressPng: true,
            compressOgg: true,
            compressXml: true,
            compressJson: true,
            pngQuality: 0.8,
            pngStripMetadata: true,
            oggQuality: 'medium',
            minifyXml: true,
            minifyJson: true
        };

        this.fileInputRef = React.createRef();
        this.zipStructureRef = React.createRef();

        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDragLeave = this.handleDragLeave.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
        this.handleFileSelect = this.handleFileSelect.bind(this);
        this.processZip = this.processZip.bind(this);
        this.downloadResult = this.downloadResult.bind(this);
        this.togglePanel = this.togglePanel.bind(this);
    }

    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logMessage = `${LOG_PREFIX} ${message}`;
        if (data) {
            console[level](logMessage, data);
        } else {
            console[level](logMessage);
        }
    }

    logDebug(message, data) { this.log('debug', message, data); }
    logInfo(message, data) { this.log('info', message, data); }
    logWarn(message, data) { this.log('warn', message, data); }
    logError(message, data) { this.log('error', message, data); }

    togglePanel() {
        this.setState(prev => ({ isExpanded: !prev.isExpanded }));
    }

    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        this.setState({ isDragging: true });
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        this.setState({ isDragging: false });
    }

    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        this.setState({ isDragging: false });

        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].name.endsWith('.zip')) {
            this.loadZip(files[0]);
        }
    }

    handleFileSelect(e) {
        const files = e.target.files;
        if (files.length > 0) {
            this.loadZip(files[0]);
        }
    }

    async loadZip(file) {
        this.logDebug('Reading ZIP...', { fileName: file.name, size: file.size });

        try {
            const zip = await JSZip.loadAsync(file);
            const structure = this.buildStructure(zip);
            
            this.logInfo('Reading ZIP complete', { fileCount: structure.files.length });

            this.setState({
                selectedFile: {
                    file,
                    name: file.name,
                    size: file.size
                },
                zipStructure: structure,
                result: null,
                errors: [],
                warnings: [],
                oggUnavailable: false
            });
        } catch (error) {
            this.logError('Failed to read ZIP', { error: error.message });
            this.setState({
                errors: [{ file: file.name, error: 'Failed to read ZIP: ' + error.message }]
            });
        }
    }

    buildStructure(zip) {
        const files = [];
        const folders = new Set();

        zip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir) {
                const pathParts = relativePath.split('/');
                pathParts.pop();
                pathParts.forEach((part, index) => {
                    const folderPath = pathParts.slice(0, index + 1).join('/') + '/';
                    if (!folders.has(folderPath)) {
                        folders.add(folderPath);
                        const parentPath = index > 0 ? pathParts.slice(0, index).join('/') + '/' : '';
                        files.push({
                            name: part,
                            path: folderPath,
                            fullPath: folderPath,
                            isFolder: true,
                            parentPath: parentPath || null
                        });
                    }
                });

                const ext = this.getFileExtension(relativePath);
                files.push({
                    name: zipEntry.name.split('/').pop(),
                    path: relativePath,
                    fullPath: relativePath,
                    isFolder: false,
                    // Files were missing parentPath entirely. Every one of them then
                    // satisfied the "no parent" test and got listed at the root,
                    // while directChildren - which matches on parentPath - never
                    // found a single file to nest under its folder.
                    parentPath: pathParts.length ? pathParts.join('/') + '/' : null,
                    size: zipEntry._data ? zipEntry._data.uncompressedSize : 0,
                    type: this.getFileType(ext)
                });
            }
        });

        return { files, folders: Array.from(folders) };
    }

    getFileExtension(filename) {
        const match = filename.match(/\.([^.]+)$/);
        return match ? match[1].toLowerCase() : '';
    }

    getFileType(ext) {
        const types = {
            'png': 'PNG',
            'ogg': 'OGG',
            'xml': 'XML',
            'json': 'JSON'
        };
        return types[ext] || 'OTHER';
    }

    async processZip() {
        if (!this.state.selectedFile) return;

        this.setState({ isProcessing: true, progress: 0, errors: [], warnings: [], result: null, oggUnavailable: false });

        const zip = await JSZip.loadAsync(this.state.selectedFile.file);
        const outputZip = new JSZip();
        const fileResults = [];
        let totalOriginalSize = 0;
        let totalCompressedSize = 0;
        const errors = [];
        const warnings = [];

        const files = Array.from(zip.filter((item) => !item.dir));
        const totalFiles = files.length;

        this.logDebug('Processing ZIP', { totalFiles });

        for (let i = 0; i < files.length; i++) {
            const zipEntry = files[i];
            const fileName = zipEntry.name;
            const ext = this.getFileExtension(fileName);
            const fileType = this.getFileType(ext);
            
            this.setState({ progress: Math.round((i / totalFiles) * 100), currentFile: fileName });
            this.logDebug('Processing', { file: fileName, type: fileType, size: zipEntry._data?.uncompressedSize });

            // setState alone does not force a paint, and every await below can
            // resolve purely through microtasks (JSZip's decompression included) -
            // without a real task-queue yield the browser never gets a rendering
            // opportunity between files, so the progress bar never moves and the
            // tab reads as hung even though the loop is technically async.
            await new Promise(resolve => setTimeout(resolve, 0));

            try {
                const originalData = await zipEntry.async('uint8array');
                const originalSize = originalData.length;
                totalOriginalSize += originalSize;

                let processedData = originalData;
                let compressed = false;
                let compressionResult = null;
                let attemptedOperation = null;

                // Check if this file type should be compressed
                const shouldCompress = this.state.compressAll || this.state[`compress${fileType}`];

                if (fileType === 'PNG' && shouldCompress && this.state.compressPng) {
                    processedData = await this.compressPng(originalData, fileName, errors, warnings);
                    compressed = processedData !== originalData;
                    attemptedOperation = `PNG compression (quality: ${this.state.pngQuality}, strip metadata: ${this.state.pngStripMetadata})`;
                } else if (fileType === 'OGG' && shouldCompress && this.state.compressOgg) {
                    const oggResult = await this.compressOgg(originalData, fileName, errors, warnings);
                    if (oggResult.skipped) {
                        warnings.push({ file: fileName, message: 'OGG WASM encoder not available (copied as-is)' });
                    } else {
                        processedData = oggResult.data;
                        compressed = processedData !== originalData;
                    }
                    attemptedOperation = `OGG quality reduction to preset: ${this.state.oggQuality}`;
                } else if (fileType === 'XML' && shouldCompress && this.state.compressXml) {
                    const result = this.compressXml(originalData, fileName, errors, warnings);
                    processedData = result.data;
                    compressed = result.compressed;
                    attemptedOperation = `XML minification`;
                } else if (fileType === 'JSON' && shouldCompress && this.state.compressJson) {
                    const result = this.compressJson(originalData, fileName, errors, warnings);
                    processedData = result.data;
                    compressed = result.compressed;
                    attemptedOperation = `JSON minification`;
                }

                const processedSize = processedData.length;
                totalCompressedSize += processedSize;

                // Add the processed file to output zip
                outputZip.file(fileName, processedData);

                if (compressed) {
                    const reduction = ((1 - processedSize / originalSize) * 100).toFixed(1);
                    this.logInfo(`✓ ${fileName} compressed`, { original: originalSize, compressed: processedSize, reduction: `${reduction}%` });
                    fileResults.push({
                        file: fileName,
                        type: fileType,
                        originalSize,
                        compressedSize: processedSize,
                        reduction: parseFloat(reduction),
                        success: true
                    });
                } else {
                    this.logDebug('File processed (no change)', { file: fileName, type: fileType });
                    fileResults.push({
                        file: fileName,
                        type: fileType,
                        originalSize,
                        compressedSize: processedSize,
                        reduction: 0,
                        success: true,
                        unchanged: true
                    });
                }

            } catch (error) {
                const originalData = await zipEntry.async('uint8array');
                const originalSize = originalData.length;

                // On error: include original file + .error.txt
                outputZip.file(fileName, originalData);
                const errorFileName = fileName.replace(/\.[^.]+$/, '.error.txt');
                const errorContent = this.generateErrorReport(fileName, fileType, error, originalSize);
                outputZip.file(errorFileName, errorContent);

                errors.push({
                    file: fileName,
                    type: fileType,
                    error: error.message,
                    stack: error.stack || 'No stack trace',
                    attemptedOperation: `Compress ${fileType}`
                });

                this.logError(`✗ ${fileName} FAILED`, { error: error.message, stack: error.stack });
            }

            this.setState({ progress: Math.round(((i + 1) / totalFiles) * 100) });
        }

        this.logDebug('Repacking ZIP...');
        this.setState({ currentFile: 'Generating output...' });

        const outputBlob = await outputZip.generateAsync({ type: 'blob' });
        this.logInfo('Repacking complete', { outputSize: outputBlob.size });

        const outputName = this.state.selectedFile.name.replace('.zip', '-compressed.zip');

        this.setState({
            isProcessing: false,
            progress: 100,
            result: {
                data: outputBlob,
                name: outputName,
                size: outputBlob.size,
                originalSize: this.state.selectedFile.size,
                fileResults,
                totalReduction: ((1 - outputBlob.size / this.state.selectedFile.size) * 100).toFixed(1)
            },
            errors,
            warnings,
            currentFile: ''
        });
    }

    generateErrorReport(file, type, error, originalSize) {
        const timestamp = new Date().toISOString();
        return `[COMPRESSION ERROR]
File: ${file}
Type: ${type}
Error: ${error.message || String(error)}
Stack: ${error.stack || 'No stack trace available'}
Attempted operation: Compress ${type}
Original size: ${originalSize} bytes
Timestamp: ${timestamp}
`;
    }

    async compressPng(data, fileName, errors, warnings) {
        try {
            // Shared encoder: quantizes to a palette and picks the best scanline
            // filters. The previous browser-image-compression call could not shrink
            // a PNG at all - canvas ignores `quality` for image/png - and returns
            // the original bytes when it cannot do better.
            return await compressPngUtil(data, fileName, {
                quality: this.state.pngQuality,
                stripMetadata: this.state.pngStripMetadata
            });
        } catch (error) {
            errors.push({ file: fileName, error: error.message });
            throw error;
        }
    }

    async compressOgg(data, fileName, errors, warnings) {
        // OGG compression requires WASM encoder - currently not available
        // Return skipped status to trigger warning and copy original
        this.logWarn('⚠ music.ogg skipped: OGG WASM encoder not available (copied as-is)', { file: fileName });
        this.setState(prev => ({ oggUnavailable: true }));
        return { skipped: true, data };
    }

    compressXml(data, fileName, errors, warnings) {
        try {
            const text = new TextDecoder().decode(data);
            
            if (!this.state.minifyXml) {
                return { data, compressed: false };
            }

            // Simple XML minification
            let minified = text
                .replace(/>\s+</g, '><')
                .replace(/\s+/g, ' ')
                .trim();

            const minifiedData = new TextEncoder().encode(minified);
            return { data: minifiedData, compressed: minifiedData.length < data.length };
        } catch (error) {
            errors.push({ file: fileName, error: error.message });
            return { data, compressed: false };
        }
    }

    compressJson(data, fileName, errors, warnings) {
        try {
            const text = new TextDecoder().decode(data);
            
            if (!this.state.minifyJson) {
                return { data, compressed: false };
            }

            const parsed = JSON.parse(text);
            const minified = JSON.stringify(parsed);
            const minifiedData = new TextEncoder().encode(minified);
            
            return { data: minifiedData, compressed: minifiedData.length < data.length };
        } catch (error) {
            errors.push({ file: fileName, error: error.message });
            return { data, compressed: false };
        }
    }

    downloadResult() {
        if (!this.state.result) return;

        const url = URL.createObjectURL(this.state.result.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.state.result.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    formatBytes(bytes) {
        // JSZip only exposes uncompressedSize on a private field, so a missing size
        // is plausible; without this the tree renders "NaN undefined".
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    renderFileTree() {
        const { files } = this.state.zipStructure || { files: [] };
        const rootItems = files.filter(f => !f.parentPath && !f.isFolder);
        const rootFolders = files.filter(f => !f.parentPath && f.isFolder);

        const renderFolder = (folderName, level = 0) => {
            const folderPath = folderName;
            const directChildren = files.filter(f => f.parentPath === folderPath);

            return (
                <div key={folderName} style={{ marginLeft: level * 15 }}>
                    <div style={styles.folderItem}>
                        <span style={styles.folderIcon}>📁</span>
                        <span style={styles.folderName}>{folderName.replace(/\/$/, '')}</span>
                    </div>
                    {directChildren.map(child => {
                        if (child.isFolder) {
                            return renderFolder(child.fullPath, level + 1);
                        }
                        return (
                            <div key={child.fullPath} style={{ ...styles.fileItem, marginLeft: (level + 1) * 15 }}>
                                <span style={styles.fileIcon}>{this.getFileTypeIcon(child.type)}</span>
                                <span style={styles.fileName}>{child.name}</span>
                                <span style={styles.fileSize}>{this.formatBytes(child.size)}</span>
                            </div>
                        );
                    })}
                </div>
            );
        };

        return (
            <div style={styles.fileTree}>
                {rootFolders.map(folder => renderFolder(folder.fullPath))}
                {rootItems.map(file => (
                    <div key={file.fullPath} style={styles.fileItem}>
                        <span style={styles.fileIcon}>{this.getFileTypeIcon(file.type)}</span>
                        <span style={styles.fileName}>{file.name}</span>
                        <span style={styles.fileSize}>{this.formatBytes(file.size)}</span>
                    </div>
                ))}
            </div>
        );
    }

    getFileTypeIcon(type) {
        const icons = {
            'PNG': '🖼️',
            'OGG': '🎵',
            'XML': '📄',
            'JSON': '📋',
            'OTHER': '📦'
        };
        return icons[type] || icons.OTHER;
    }

    render() {
        const { isExpanded, blockSize, quality, colorProfile, outputFormat } = this.state;
        
        return (
            <div className="zip-compressor-panel" style={styles.panel}>
                {/* Header */}
                <div style={styles.header} onClick={this.togglePanel}>
                    <span style={styles.title}>📦 Compresor de Assets ZIP</span>
                    <span style={styles.toggleIcon}>{isExpanded ? '▼' : '▲'}</span>
                </div>
                
                {/* Content */}
                {isExpanded && (
                    <div style={styles.content}>
                        {/* OGG Unavailable Notice */}
                        {this.state.oggUnavailable && (
                            <div style={styles.notice}>
                                ⚠️ La compresión OGG no está disponible (no se encontró codificador WASM). 
                                Los archivos OGG se copiaron sin cambios.
                            </div>
                        )}

                        {/* Drop Zone */}
                        <div
                            style={{
                                ...styles.dropZone,
                                ...(this.state.isDragging ? styles.dropZoneActive : {}),
                                ...(this.state.selectedFile ? styles.dropZoneSmall : {})
                            }}
                            onDragOver={this.handleDragOver}
                            onDragLeave={this.handleDragLeave}
                            onDrop={this.handleDrop}
                            onClick={() => this.fileInputRef.current?.click()}
                        >
                            <input
                                ref={this.fileInputRef}
                                type="file"
                                accept=".zip"
                                style={{ display: 'none' }}
                                onChange={this.handleFileSelect}
                            />
                            
                            {this.state.selectedFile ? (
                                <div style={styles.fileInfo}>
                                    <span style={styles.zipIcon}>📦</span>
                                    <div>
                                        <div style={styles.fileName}>{this.state.selectedFile.name}</div>
                                        <div style={styles.fileSize}>{this.formatBytes(this.state.selectedFile.size)}</div>
                                    </div>
                                </div>
                            ) : (
                                <div style={styles.dropText}>
                                    <div>📁 Arrastra un archivo .zip aquí</div>
                                    <div style={styles.dropSubtext}>o haz clic para seleccionar</div>
                                </div>
                            )}
                        </div>

                        {/* ZIP Structure Preview */}
                        {this.state.zipStructure && (
                            <div style={styles.section}>
                                <div style={styles.sectionTitle}>Contenido del ZIP ({this.state.zipStructure.files.length} archivos)</div>
                                <div ref={this.zipStructureRef} style={styles.structureContainer}>
                                    {this.renderFileTree()}
                                </div>
                            </div>
                        )}

                        {/* Compression Options */}
                        <div style={styles.section}>
                            <div style={styles.sectionTitle}>Opciones de Compresión</div>
                            
                            {/* Global Options */}
                            <div style={styles.configRow}>
                                <label style={styles.checkboxLabel}>
                                    <input
                                        type="checkbox"
                                        checked={this.state.compressAll}
                                        onChange={(e) => this.setState({ compressAll: e.target.checked })}
                                        style={styles.checkbox}
                                    />
                                    <span>Comprimir todos los tipos soportados</span>
                                </label>
                            </div>

                            {/* PNG Options */}
                            <div style={styles.configRow}>
                                <label style={styles.checkboxLabel}>
                                    <input
                                        type="checkbox"
                                        checked={this.state.compressPng}
                                        onChange={(e) => this.setState({ compressPng: e.target.checked })}
                                        style={styles.checkbox}
                                        disabled={this.state.compressAll}
                                    />
                                    <span>🖼️ PNG (recomprimir imagen)</span>
                                </label>
                            </div>
                            {(this.state.compressPng || this.state.compressAll) && (
                                <div style={{ ...styles.subOptions, marginLeft: 20 }}>
                                    <div style={styles.configRow}>
                                        <label style={styles.label}>Calidad:</label>
                                        <input
                                            type="range"
                                            min="0.1"
                                            max="1"
                                            step="0.1"
                                            value={this.state.pngQuality}
                                            onChange={(e) => this.setState({ pngQuality: parseFloat(e.target.value) })}
                                            style={styles.slider}
                                        />
                                        <span style={styles.sliderValue}>{(this.state.pngQuality * 100).toFixed(0)}%</span>
                                    </div>
                                    <div style={styles.configRow}>
                                        <label style={styles.checkboxLabel}>
                                            <input
                                                type="checkbox"
                                                checked={this.state.pngStripMetadata}
                                                onChange={(e) => this.setState({ pngStripMetadata: e.target.checked })}
                                                style={styles.checkbox}
                                            />
                                            <span>Eliminar metadatos</span>
                                        </label>
                                    </div>
                                </div>
                            )}

                            {/* OGG Options */}
                            <div style={styles.configRow}>
                                <label style={styles.checkboxLabel}>
                                    <input
                                        type="checkbox"
                                        checked={this.state.compressOgg}
                                        onChange={(e) => this.setState({ compressOgg: e.target.checked })}
                                        style={styles.checkbox}
                                        disabled={this.state.compressAll}
                                    />
                                    <span>🎵 OGG (calidad de audio)</span>
                                </label>
                            </div>
                            {(this.state.compressOgg || this.state.compressAll) && (
                                <div style={{ ...styles.subOptions, marginLeft: 20 }}>
                                    <div style={styles.configRow}>
                                        <label style={styles.label}>Presete:</label>
                                        <select
                                            style={styles.select}
                                            value={this.state.oggQuality}
                                            onChange={(e) => this.setState({ oggQuality: e.target.value })}
                                        >
                                            <option value="low">Bajo (menor calidad, menor tamaño)</option>
                                            <option value="medium">Medio</option>
                                            <option value="high">Alto (mayor calidad)</option>
                                        </select>
                                    </div>
                                </div>
                            )}

                            {/* XML Options */}
                            <div style={styles.configRow}>
                                <label style={styles.checkboxLabel}>
                                    <input
                                        type="checkbox"
                                        checked={this.state.compressXml}
                                        onChange={(e) => this.setState({ compressXml: e.target.checked })}
                                        style={styles.checkbox}
                                        disabled={this.state.compressAll}
                                    />
                                    <span>📄 XML (minificar)</span>
                                </label>
                            </div>
                            {(this.state.compressXml || this.state.compressAll) && (
                                <div style={{ ...styles.subOptions, marginLeft: 20 }}>
                                    <div style={styles.configRow}>
                                        <label style={styles.checkboxLabel}>
                                            <input
                                                type="checkbox"
                                                checked={this.state.minifyXml}
                                                onChange={(e) => this.setState({ minifyXml: e.target.checked })}
                                                style={styles.checkbox}
                                            />
                                            <span>Eliminar espacios en blanco</span>
                                        </label>
                                    </div>
                                </div>
                            )}

                            {/* JSON Options */}
                            <div style={styles.configRow}>
                                <label style={styles.checkboxLabel}>
                                    <input
                                        type="checkbox"
                                        checked={this.state.compressJson}
                                        onChange={(e) => this.setState({ compressJson: e.target.checked })}
                                        style={styles.checkbox}
                                        disabled={this.state.compressAll}
                                    />
                                    <span>📋 JSON (minificar)</span>
                                </label>
                            </div>
                            {(this.state.compressJson || this.state.compressAll) && (
                                <div style={{ ...styles.subOptions, marginLeft: 20 }}>
                                    <div style={styles.configRow}>
                                        <label style={styles.checkboxLabel}>
                                            <input
                                                type="checkbox"
                                                checked={this.state.minifyJson}
                                                onChange={(e) => this.setState({ minifyJson: e.target.checked })}
                                                style={styles.checkbox}
                                            />
                                            <span>Eliminar espacios en blanco</span>
                                        </label>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Info */}
                        <div style={styles.info}>
                            <p>📦 <strong>Tipos soportados:</strong> PNG, OGG, XML, JSON</p>
                            <p>🔄 Otros archivos se copian sin cambios</p>
                            <p>⚠️ Los archivos que fallen generarán un reporte .error.txt</p>
                        </div>
                        
                        {/* Progress */}
                        {this.state.isProcessing && (
                            <div style={styles.progressContainer}>
                                <div style={styles.progressBar}>
                                    <div style={{ ...styles.progressFill, width: `${this.state.progress}%` }} />
                                </div>
                                <span>Procesando... {this.state.progress}%</span>
                                {this.state.currentFile && (
                                    <span style={styles.currentFile}>📄 {this.state.currentFile}</span>
                                )}
                            </div>
                        )}
                        
                        {/* Errors */}
                        {this.state.errors.length > 0 && (
                            <div style={styles.errorsContainer}>
                                <div style={styles.errorsTitle}>❌ Archivos con errores:</div>
                                {this.state.errors.map((err, idx) => (
                                    <div key={idx} style={styles.errorItem}>
                                        <strong>{err.file}</strong>: {err.error}
                                    </div>
                                ))}
                            </div>
                        )}
                        
                        {/* Warnings */}
                        {this.state.warnings.length > 0 && (
                            <div style={styles.warningsContainer}>
                                {this.state.warnings.map((warn, idx) => (
                                    <div key={idx} style={styles.warningItem}>
                                        ⚠️ {warn.file}: {warn.message}
                                    </div>
                                ))}
                            </div>
                        )}
                        
                        {/* Result */}
                        {this.state.result && (
                            <div style={styles.result}>
                                <h4 style={styles.resultTitle}>✅ Compresión Completada</h4>
                                <div style={styles.resultInfo}>
                                    <p><strong>Archivo:</strong> {this.state.result.name}</p>
                                    <p><strong>Tamaño original:</strong> {this.formatBytes(this.state.result.originalSize)}</p>
                                    <p><strong>Tamaño salida:</strong> {this.formatBytes(this.state.result.size)}</p>
                                    <p><strong>Reducción total:</strong> {this.state.result.totalReduction}%</p>
                                </div>
                                
                                {/* File Results Summary */}
                                <div style={styles.summaryTable}>
                                    <div style={styles.summaryHeader}>
                                        <span>Archivo</span>
                                        <span>Tipo</span>
                                        <span>Original</span>
                                        <span>Comprimido</span>
                                        <span>Reducción</span>
                                    </div>
                                    {this.state.result.fileResults.filter(f => !f.unchanged).map((file, idx) => (
                                        <div key={idx} style={styles.summaryRow}>
                                            <span style={styles.summaryFile}>{file.file.split('/').pop()}</span>
                                            <span>{file.type}</span>
                                            <span>{this.formatBytes(file.originalSize)}</span>
                                            <span>{this.formatBytes(file.compressedSize)}</span>
                                            <span style={file.reduction > 0 ? styles.reductionPositive : styles.reductionNegative}>
                                                {file.reduction > 0 ? `-${file.reduction}%` : '0%'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                
                                <button style={styles.downloadBtn} onClick={this.downloadResult}>
                                    ⬇️ Descargar ZIP Comprimido
                                </button>
                            </div>
                        )}
                        
                        {/* Process Button */}
                        <button
                            style={{
                                ...styles.convertBtn,
                                ...(this.state.isProcessing || !this.state.selectedFile ? styles.convertBtnDisabled : {})
                            }}
                            onClick={this.processZip}
                            disabled={!this.state.selectedFile || this.state.isProcessing}
                        >
                            {this.state.isProcessing ? '⏳ Procesando...' : '🔄 Comprimir Assets'}
                        </button>
                    </div>
                )}
            </div>
        );
    }
}

const styles = {
    panel: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        marginTop: '10px',
        overflow: 'hidden',
        border: '1px solid #444'
    },
    header: {
        padding: '12px 15px',
        backgroundColor: '#333',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    title: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: '14px'
    },
    toggleIcon: {
        color: '#888',
        fontSize: '12px'
    },
    content: {
        padding: '15px'
    },
    dropZone: {
        border: '2px dashed #666',
        borderRadius: '8px',
        padding: '30px',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all 0.2s',
        marginBottom: '15px'
    },
    dropZoneActive: {
        borderColor: '#4a9eff',
        backgroundColor: 'rgba(74, 158, 255, 0.1)'
    },
    dropZoneSmall: {
        padding: '15px'
    },
    dropText: {
        color: '#888',
        fontSize: '14px'
    },
    dropSubtext: {
        color: '#666',
        fontSize: '12px',
        marginTop: '5px'
    },
    fileInfo: {
        display: 'flex',
        alignItems: 'center',
        gap: '15px'
    },
    zipIcon: {
        fontSize: '32px'
    },
    fileName: {
        color: '#fff',
        fontSize: '14px',
        fontWeight: 'bold'
    },
    fileSize: {
        color: '#888',
        fontSize: '12px'
    },
    section: {
        marginBottom: '15px'
    },
    sectionTitle: {
        color: '#fff',
        fontSize: '13px',
        marginBottom: '10px',
        borderBottom: '1px solid #444',
        paddingBottom: '5px'
    },
    structureContainer: {
        maxHeight: '200px',
        overflowY: 'auto',
        backgroundColor: '#222',
        borderRadius: '6px',
        padding: '10px'
    },
    fileTree: {
        fontSize: '12px'
    },
    fileItem: {
        display: 'flex',
        alignItems: 'center',
        padding: '4px 8px',
        gap: '8px',
        borderRadius: '4px',
        color: '#ccc'
    },
    fileIcon: {
        fontSize: '14px'
    },
    folderItem: {
        display: 'flex',
        alignItems: 'center',
        padding: '4px 8px',
        gap: '8px',
        color: '#4a9eff',
        fontWeight: 'bold'
    },
    folderIcon: {
        fontSize: '14px'
    },
    folderName: {
        fontSize: '12px'
    },
    configSection: {
        marginBottom: '15px'
    },
    configRow: {
        display: 'flex',
        alignItems: 'center',
        marginBottom: '8px',
        gap: '10px',
        flexWrap: 'wrap'
    },
    label: {
        color: '#aaa',
        fontSize: '12px',
        minWidth: '80px'
    },
    checkboxLabel: {
        color: '#ccc',
        fontSize: '13px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer'
    },
    checkbox: {
        width: '16px',
        height: '16px',
        cursor: 'pointer'
    },
    select: {
        padding: '6px 10px',
        backgroundColor: '#333',
        color: '#fff',
        border: '1px solid #555',
        borderRadius: '4px',
        fontSize: '12px'
    },
    slider: {
        flex: 1,
        minWidth: '100px',
        cursor: 'pointer'
    },
    sliderValue: {
        color: '#4a9eff',
        fontSize: '12px',
        minWidth: '40px'
    },
    subOptions: {
        padding: '8px',
        backgroundColor: '#252525',
        borderRadius: '6px',
        marginBottom: '10px'
    },
    notice: {
        color: '#ff9800',
        backgroundColor: 'rgba(255, 152, 0, 0.1)',
        padding: '10px',
        borderRadius: '6px',
        marginBottom: '15px',
        fontSize: '13px',
        border: '1px solid #ff9800'
    },
    info: {
        backgroundColor: '#222',
        padding: '10px',
        borderRadius: '6px',
        marginBottom: '15px'
    },
    progressContainer: {
        marginBottom: '15px'
    },
    progressBar: {
        height: '8px',
        backgroundColor: '#333',
        borderRadius: '4px',
        overflow: 'hidden',
        marginBottom: '5px'
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#4a9eff',
        transition: 'width 0.2s'
    },
    currentFile: {
        display: 'block',
        color: '#888',
        fontSize: '11px',
        marginTop: '5px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
    },
    errorsContainer: {
        color: '#ff6b6b',
        backgroundColor: 'rgba(255, 107, 107, 0.1)',
        padding: '10px',
        borderRadius: '6px',
        marginBottom: '15px',
        fontSize: '13px',
        border: '1px solid #ff6b6b'
    },
    errorsTitle: {
        fontWeight: 'bold',
        marginBottom: '8px'
    },
    errorItem: {
        marginBottom: '5px',
        paddingLeft: '10px'
    },
    warningsContainer: {
        color: '#ff9800',
        backgroundColor: 'rgba(255, 152, 0, 0.1)',
        padding: '10px',
        borderRadius: '6px',
        marginBottom: '15px',
        fontSize: '13px',
        border: '1px solid #ff9800'
    },
    warningItem: {
        marginBottom: '5px'
    },
    result: {
        backgroundColor: 'rgba(46, 204, 113, 0.1)',
        padding: '15px',
        borderRadius: '6px',
        marginBottom: '15px',
        border: '1px solid #2ecc71'
    },
    resultTitle: {
        color: '#2ecc71',
        marginTop: 0,
        marginBottom: '10px',
        fontSize: '14px'
    },
    resultInfo: {
        color: '#ccc',
        fontSize: '12px',
        marginBottom: '10px'
    },
    summaryTable: {
        marginTop: '10px',
        fontSize: '11px',
        color: '#ccc'
    },
    summaryHeader: {
        display: 'grid',
        gridTemplateColumns: '2fr 0.5fr 1fr 1fr 0.8fr',
        gap: '5px',
        padding: '8px',
        backgroundColor: '#333',
        borderRadius: '4px',
        fontWeight: 'bold',
        color: '#fff'
    },
    summaryRow: {
        display: 'grid',
        gridTemplateColumns: '2fr 0.5fr 1fr 1fr 0.8fr',
        gap: '5px',
        padding: '6px 8px',
        borderBottom: '1px solid #333'
    },
    summaryFile: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
    },
    reductionPositive: {
        color: '#2ecc71'
    },
    reductionNegative: {
        color: '#888'
    },
    downloadBtn: {
        width: '100%',
        padding: '10px',
        backgroundColor: '#2ecc71',
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: 'bold',
        fontSize: '14px',
        marginTop: '10px'
    },
    convertBtn: {
        width: '100%',
        padding: '12px',
        backgroundColor: '#4a9eff',
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: 'bold',
        fontSize: '14px'
    },
    convertBtnDisabled: {
        backgroundColor: '#555',
        cursor: 'not-allowed'
    }
};

export default ZipAssetCompressor;