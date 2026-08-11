import React from 'react';
import astcEncoder from '../utils/astc/ASTCEncoder';

class ASTCConverter extends React.Component {
    constructor(props) {
        super(props);
        
        this.state = {
            isExpanded: false,
            isDragging: false,
            selectedImage: null,
            imagePreview: null,
            isConverting: false,
            progress: 0,
            result: null,
            error: null,
            
            // Configuraciones
            blockSize: '4x4',
            quality: 'medium',
            colorProfile: 'ldr-rgba',
            outputFormat: 'raw', // 'raw' o 'ktx2'
            includeMipmaps: false
        };
        
        this.canvasRef = React.createRef();
        this.fileInputRef = React.createRef();
        
        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDragLeave = this.handleDragLeave.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
        this.handleFileSelect = this.handleFileSelect.bind(this);
        this.convertToASTC = this.convertToASTC.bind(this);
        this.downloadResult = this.downloadResult.bind(this);
        this.togglePanel = this.togglePanel.bind(this);
    }
    
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
        if (files.length > 0 && files[0].type.startsWith('image/')) {
            this.loadImage(files[0]);
        }
    }
    
    handleFileSelect(e) {
        const files = e.target.files;
        if (files.length > 0) {
            this.loadImage(files[0]);
        }
    }
    
    loadImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Draw to canvas for pixel access
                const canvas = this.canvasRef.current;
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                
                this.setState({
                    selectedImage: {
                        file,
                        name: file.name,
                        width: img.width,
                        height: img.height,
                        size: file.size
                    },
                    imagePreview: e.target.result,
                    result: null,
                    error: null,
                    progress: 0
                });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
    
    async convertToASTC() {
        if (!this.state.selectedImage) return;
        
        this.setState({ isConverting: true, progress: 0, error: null });
        
        try {
            const canvas = this.canvasRef.current;
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            
            const options = {
                blockSize: this.state.blockSize,
                quality: this.state.quality,
                colorProfile: this.state.colorProfile
            };
            
            // Simulate progress for better UX
            const progressInterval = setInterval(() => {
                this.setState(prev => ({
                    progress: Math.min(prev.progress + 10, 90)
                }));
            }, 100);
            
            // Encode to ASTC
            let astcData = await astcEncoder.encode(imageData, options);
            
            // Create output file
            let outputData;
            let extension;
            
            if (this.state.outputFormat === 'ktx2') {
                astcData = astcEncoder.createKTX2(astcData, canvas.width, canvas.height, this.state.blockSize);
                extension = 'ktx2';
            } else {
                extension = 'astc';
            }
            
            clearInterval(progressInterval);
            
            // Calculate output size
            const outputSize = astcData.byteLength;
            const compressionRatio = ((1 - outputSize / (canvas.width * canvas.height * 4)) * 100).toFixed(1);
            
            this.setState({
                isConverting: false,
                progress: 100,
                result: {
                    data: astcData,
                    name: this.state.selectedImage.name.replace(/\.[^.]+$/, `.astc.${extension}`),
                    size: outputSize,
                    compressionRatio,
                    width: canvas.width,
                    height: canvas.height,
                    blockSize: this.state.blockSize,
                    format: extension.toUpperCase()
                }
            });
            
        } catch (error) {
            console.error('ASTC conversion error:', error);
            this.setState({
                isConverting: false,
                progress: 0,
                error: 'Error en la conversión: ' + error.message
            });
        }
    }
    
    downloadResult() {
        if (!this.state.result) return;
        
        const blob = new Blob([this.state.result.data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.state.result.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    render() {
        const { isExpanded, blockSize, quality, colorProfile, outputFormat } = this.state;
        
        return (
            <div className="astc-converter-panel" style={styles.panel}>
                {/* Header */}
                <div style={styles.header} onClick={this.togglePanel}>
                    <span style={styles.title}>🎮 Convertidor ASTC</span>
                    <span style={styles.toggleIcon}>{isExpanded ? '▼' : '▲'}</span>
                </div>
                
                {/* Content */}
                {isExpanded && (
                    <div style={styles.content}>
                        {/* Hidden canvas for pixel extraction */}
                        <canvas ref={this.canvasRef} style={{ display: 'none' }} />
                        
                        {/* Drop Zone */}
                        <div
                            style={{
                                ...styles.dropZone,
                                ...(this.state.isDragging ? styles.dropZoneActive : {}),
                                ...(this.state.selectedImage ? styles.dropZoneSmall : {})
                            }}
                            onDragOver={this.handleDragOver}
                            onDragLeave={this.handleDragLeave}
                            onDrop={this.handleDrop}
                            onClick={() => this.fileInputRef.current?.click()}
                        >
                            <input
                                ref={this.fileInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={this.handleFileSelect}
                            />
                            
                            {this.state.selectedImage ? (
                                <div style={styles.imageInfo}>
                                    <img src={this.state.imagePreview} style={styles.preview} alt="Preview" />
                                    <div style={styles.infoText}>
                                        <strong>{this.state.selectedImage.name}</strong>
                                        <br />
                                        {this.state.selectedImage.width} × {this.state.selectedImage.height}px
                                        <br />
                                        {this.formatBytes(this.state.selectedImage.size)}
                                    </div>
                                </div>
                            ) : (
                                <div style={styles.dropText}>
                                    📁 Arrastra PNG aquí o haz clic para seleccionar
                                </div>
                            )}
                        </div>
                        
                        {/* Configuration */}
                        <div style={styles.configSection}>
                            <h4 style={styles.sectionTitle}>⚙️ Configuración</h4>
                            
                            {/* Block Size */}
                            <div style={styles.configRow}>
                                <label style={styles.label}>Tamaño de bloque:</label>
                                <select
                                    style={styles.select}
                                    value={blockSize}
                                    onChange={(e) => this.setState({ blockSize: e.target.value })}
                                >
                                    <option value="4x4">4×4 (Mayor calidad, mayor tamaño)</option>
                                    <option value="5x5">5×5</option>
                                    <option value="6x6">6×6</option>
                                    <option value="8x8">8×8 (Menor tamaño, menor calidad)</option>
                                    <option value="10x10">10×10</option>
                                    <option value="12x12">12×12</option>
                                </select>
                            </div>
                            
                            {/* Quality */}
                            <div style={styles.configRow}>
                                <label style={styles.label}>Calidad:</label>
                                <select
                                    style={styles.select}
                                    value={quality}
                                    onChange={(e) => this.setState({ quality: e.target.value })}
                                >
                                    <option value="fast">Rápida</option>
                                    <option value="medium">Media</option>
                                    <option value="thorough">Detallada</option>
                                    <option value="exhaustive">Exhaustiva (lento)</option>
                                </select>
                            </div>
                            
                            {/* Color Profile */}
                            <div style={styles.configRow}>
                                <label style={styles.label}>Perfil de color:</label>
                                <select
                                    style={styles.select}
                                    value={colorProfile}
                                    onChange={(e) => this.setState({ colorProfile: e.target.value })}
                                >
                                    <option value="ldr-luminance">LDR Luminance (Gris)</option>
                                    <option value="ldr-rgb">LDR RGB (Color sin alpha)</option>
                                    <option value="ldr-rgba">LDR RGBA (Color con alpha) ✓</option>
                                    <option value="hdr-rgba">HDR RGBA (Alto rango dinámico)</option>
                                </select>
                            </div>
                            
                            {/* Output Format */}
                            <div style={styles.configRow}>
                                <label style={styles.label}>Formato salida:</label>
                                <select
                                    style={styles.select}
                                    value={outputFormat}
                                    onChange={(e) => this.setState({ outputFormat: e.target.value })}
                                >
                                    <option value="raw">RAW ASTC (.astc)</option>
                                    <option value="ktx2">KTX2 Container (.ktx2)</option>
                                </select>
                            </div>
                        </div>
                        
                        {/* Info */}
                        <div style={styles.info}>
                            <p>📱 <strong>ASTC</strong> es el formato de compresión de texturas estándar para Android/OpenGL ES 3.0+</p>
                            <p>💾 Proporciona excelente compresión con calidad visual alta</p>
                            <p>🎮 Usado en Friday Night Funkin' mods para Android</p>
                        </div>
                        
                        {/* Progress */}
                        {this.state.isConverting && (
                            <div style={styles.progressContainer}>
                                <div style={styles.progressBar}>
                                    <div style={{ ...styles.progressFill, width: `${this.state.progress}%` }} />
                                </div>
                                <span>Convirtiendo... {this.state.progress}%</span>
                            </div>
                        )}
                        
                        {/* Error */}
                        {this.state.error && (
                            <div style={styles.error}>{this.state.error}</div>
                        )}
                        
                        {/* Result */}
                        {this.state.result && (
                            <div style={styles.result}>
                                <h4 style={styles.resultTitle}>✅ Conversión Completada</h4>
                                
                                {/* ⚠️ IMPORTANT WARNING */}
                                <div style={{
                                    ...styles.resultInfo,
                                    borderLeft: '4px solid var(--warning-color)',
                                    // A pale-yellow callout on #856404 text was a bright
                                    // patch in dark mode; tint the warning instead.
                                    backgroundColor: 'rgba(255, 152, 0, 0.15)',
                                    padding: '10px',
                                    marginBottom: '10px',
                                    borderRadius: '4px'
                                }}>
                                    <p style={{margin: 0, color: 'var(--text-primary)', fontSize: '11px'}}>
                                        ⚠️ <strong>EXPERIMENTAL:</strong> Este encoder ASTC es una 
                                        implementación de referencia, <strong>NO produce archivos ASTC 
                                        válidos para uso en producción</strong>. Para producción, se 
                                        requiere integrar <code>astcenc</code> (ARM) compilado a 
                                        WebAssembly.
                                    </p>
                                </div>
                                
                                <div style={styles.resultInfo}>
                                    <p><strong>Archivo:</strong> {this.state.result.name}</p>
                                    <p><strong>Formato:</strong> {this.state.result.format}</p>
                                    <p><strong>Tamaño bloque:</strong> {this.state.result.blockSize}</p>
                                    <p><strong>Tamaño salida:</strong> {this.formatBytes(this.state.result.size)}</p>
                                    <p><strong>Ratio compresión:</strong> {this.state.result.compressionRatio}% reducción</p>
                                </div>
                                <button style={styles.downloadBtn} onClick={this.downloadResult}>
                                    ⬇️ Descargar {this.state.result.format}
                                </button>
                            </div>
                        )}
                        
                        {/* Convert Button */}
                        <button
                            style={{
                                ...styles.convertBtn,
                                ...(this.state.isConverting || !this.state.selectedImage ? styles.convertBtnDisabled : {})
                            }}
                            onClick={this.convertToASTC}
                            disabled={!this.state.selectedImage || this.state.isConverting}
                        >
                            {this.state.isConverting ? '⏳ Convirtiendo...' : '🔄 Convertir a ASTC'}
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
    imageInfo: {
        display: 'flex',
        alignItems: 'center',
        gap: '15px'
    },
    preview: {
        maxWidth: '80px',
        maxHeight: '80px',
        borderRadius: '4px',
        border: '1px solid #555'
    },
    infoText: {
        color: '#ccc',
        fontSize: '13px',
        textAlign: 'left'
    },
    configSection: {
        marginBottom: '15px'
    },
    sectionTitle: {
        color: '#fff',
        fontSize: '13px',
        marginBottom: '10px',
        borderBottom: '1px solid #444',
        paddingBottom: '5px'
    },
    configRow: {
        display: 'flex',
        alignItems: 'center',
        marginBottom: '8px',
        gap: '10px'
    },
    label: {
        color: '#aaa',
        fontSize: '12px',
        minWidth: '120px'
    },
    select: {
        flex: 1,
        padding: '6px 10px',
        backgroundColor: '#333',
        color: '#fff',
        border: '1px solid #555',
        borderRadius: '4px',
        fontSize: '12px'
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
    error: {
        color: '#ff6b6b',
        backgroundColor: 'rgba(255, 107, 107, 0.1)',
        padding: '10px',
        borderRadius: '6px',
        marginBottom: '15px',
        fontSize: '13px'
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
    downloadBtn: {
        width: '100%',
        padding: '10px',
        backgroundColor: '#2ecc71',
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: 'bold',
        fontSize: '14px'
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

export default ASTCConverter;