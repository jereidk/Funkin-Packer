import React from 'react';
import { Observer, GLOBAL_EVENT } from '../Observer';
import PackProcessor from '../PackProcessor';

/**
 * SmartSizePreview - Shows real-time preview of Smart Size Solver results
 * Displays calculated dimensions, efficiency, and algorithm info
 */
class SmartSizePreview extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            visible: false,
            result: null,
            spriteCount: 0
        };
        
        // Store last known options to correlate with images changes
        this.lastOptions = {};
        
        // Listen for pack options changes to update preview
        Observer.on(GLOBAL_EVENT.PACK_OPTIONS_CHANGED, this.onOptionsChanged, this);
        Observer.on(GLOBAL_EVENT.IMAGES_LIST_CHANGED, this.onImagesChanged, this);
    }

    componentWillUnmount() {
        Observer.off(GLOBAL_EVENT.PACK_OPTIONS_CHANGED, this.onOptionsChanged, this);
        Observer.off(GLOBAL_EVENT.IMAGES_LIST_CHANGED, this.onImagesChanged, this);
    }

    onOptionsChanged(options) {
        // Store options for later use when images change
        this.lastOptions = options || {};
        this.updatePreview(this.lastOptions);
    }

    onImagesChanged(images) {
        // Use the stored options - no need for invalid fallbacks
        this.updatePreview(this.lastOptions, images);
    }

    updatePreview(options, images) {
        if (!options) return;
        
        const solverMode = options.solverMode || 'manual';
        
        // Only show preview when not in manual mode
        if (solverMode === 'manual') {
            this.setState({ visible: false, result: null });
            return;
        }

        // images parameter comes from the event directly
        // If not provided, there's nothing to process
        if (!images) {
            this.setState({ visible: true, result: null, spriteCount: 0 });
            return;
        }

        const rects = this.prepareRects(images);
        
        if (rects.length === 0) {
            this.setState({ visible: true, result: null, spriteCount: 0 });
            return;
        }

        // Calculate optimal dimensions
        const result = PackProcessor.calculateOptimalDimensions(rects, {
            width: options.width || 4096,
            height: options.height || 4096,
            solverMode: solverMode,
            spritePadding: options.spritePadding || 0,
            borderPadding: options.borderPadding || 0,
            allowRotation: options.allowRotation || false,
            disableMaxLimit: options.disableMaxLimit || false,
            packingAlgorithm: options.packingAlgorithm || 'best',
            // Must match what the real pack does, or the preview shows a size the
            // export will not produce.
            powerOfTwo: options.powerOfTwo || false
        });

        this.setState({
            visible: true,
            result: result,
            spriteCount: rects.length
        });
    }

    prepareRects(images) {
        const rects = [];
        const names = Object.keys(images);
        
        for (let key of names) {
            let img = images[key];
            rects.push({
                frame: { w: img.width, h: img.height },
                sourceSize: { w: img.width, h: img.height }
            });
        }
        
        return rects;
    }

    getEfficiencyColor(efficiency) {
        if (efficiency >= 0.8) return '#4ade80'; // green
        if (efficiency >= 0.6) return '#facc15'; // yellow
        if (efficiency >= 0.4) return '#fb923c'; // orange
        return '#f87171'; // red
    }

    getModeLabel(mode) {
        switch (mode) {
            case 'scale': return '🔄 Scale';
            case 'auto': return '🧠 Auto';
            case 'multi-atlas': return '📦 Multi-Atlas';
            default: return '⚙️ Manual';
        }
    }

    getAlgorithmShortName(algo) {
        if (!algo) return '';
        const names = {
            'maxrects_bssf': 'MaxRects-BSSF',
            'maxrects_blsf': 'MaxRects-BLSF',
            'maxrects_baf': 'MaxRects-BAF',
            'maxrects_blr': 'MaxRects-BLR',
            'maxrects_cp': 'MaxRects-CP',
            'guillotine_bssf': 'Guillotine-BSSF',
            'guillotine_baf': 'Guillotine-BAF',
            'shelf': 'Shelf',
            'skyline': 'Skyline',
            'best': 'Best'
        };
        return names[algo] || algo;
    }

    render() {
        const { visible, result, spriteCount } = this.state;
        
        if (!visible) return null;

        const styles = {
            container: {
                background: 'linear-gradient(135deg, #1e3a5f 0%, #0f1f3a 100%)',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '12px',
                border: '1px solid rgba(74, 222, 128, 0.3)',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
            },
            header: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px'
            },
            title: {
                color: '#4ade80',
                fontSize: '14px',
                fontWeight: 'bold',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
            },
            badge: {
                background: 'rgba(74, 222, 128, 0.2)',
                color: '#4ade80',
                padding: '4px 10px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 'normal'
            },
            grid: {
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '12px'
            },
            stat: {
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: '6px',
                padding: '12px',
                textAlign: 'center'
            },
            statLabel: {
                color: 'rgba(255, 255, 255, 0.6)',
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '4px'
            },
            statValue: {
                color: '#fff',
                fontSize: '18px',
                fontWeight: 'bold'
            },
            statValueSmall: {
                color: '#fff',
                fontSize: '14px',
                fontWeight: 'bold'
            },
            efficiency: {
                color: this.getEfficiencyColor(result?.efficiency || 0)
            },
            message: {
                marginTop: '12px',
                padding: '10px',
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: '6px',
                color: 'rgba(255, 255, 255, 0.8)',
                fontSize: '12px',
                textAlign: 'center'
            },
            miniPreview: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                marginTop: '12px'
            },
            previewBox: {
                width: '80px',
                height: '60px',
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '4px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255, 255, 255, 0.5)',
                fontSize: '10px',
                position: 'relative',
                overflow: 'hidden'
            },
            previewBar: {
                position: 'absolute',
                background: 'linear-gradient(90deg, rgba(74, 222, 128, 0.3), rgba(74, 222, 128, 0.6))',
                borderRadius: '2px'
            },
            arrow: {
                color: 'rgba(255, 255, 255, 0.4)',
                fontSize: '20px'
            }
        };

        if (!result) {
            return (
                <div style={styles.container}>
                    <div style={styles.header}>
                        <h4 style={styles.title}>
                            ✨ Smart Size Preview
                            <span style={styles.badge}>{spriteCount} sprites</span>
                        </h4>
                    </div>
                    <div style={styles.message}>
                        Loading preview...
                    </div>
                </div>
            );
        }

        // Calculate preview dimensions (scaled down for display)
        const maxDim = 60;
        const scale = Math.min(maxDim / result.width, maxDim / result.height);
        const previewW = Math.round(result.width * scale);
        const previewH = Math.round(result.height * scale);
        const efficiencyPct = Math.round(result.efficiency * 100);

        return (
            <div style={styles.container}>
                <div style={styles.header}>
                    <h4 style={styles.title}>
                        ✨ Smart Size Preview
                        <span style={styles.badge}>{this.getModeLabel(result.mode)}</span>
                    </h4>
                </div>

                <div style={styles.grid}>
                    <div style={styles.stat}>
                        <div style={styles.statLabel}>Calculated Width</div>
                        <div style={styles.statValue}>{result.width}px</div>
                    </div>
                    <div style={styles.stat}>
                        <div style={styles.statLabel}>Calculated Height</div>
                        <div style={styles.statValue}>{result.height}px</div>
                    </div>
                    <div style={styles.stat}>
                        <div style={styles.statLabel}>Efficiency</div>
                        <div style={{...styles.statValue, ...styles.efficiency}}>{efficiencyPct}%</div>
                    </div>
                </div>

                {result.algorithm && result.algorithm !== 'manual' && (
                    <div style={{...styles.message, marginTop: '12px'}}>
                        <strong>Algorithm:</strong> {this.getAlgorithmShortName(result.algorithm)}
                    </div>
                )}

                {result.message && (
                    <div style={styles.message}>
                        {result.message}
                    </div>
                )}

                <div style={styles.miniPreview}>
                    <div style={styles.previewBox}>
                        {result.originalWidth && (
                            <>
                                <div style={{
                                    ...styles.previewBar,
                                    width: Math.round(result.originalWidth * scale) + 'px',
                                    height: Math.round(result.originalHeight * scale) + 'px',
                                    bottom: '4px',
                                    left: '4px',
                                    background: 'rgba(255, 255, 255, 0.1)',
                                    border: '1px dashed rgba(255, 255, 255, 0.3)'
                                }} />
                            </>
                        )}
                        <div style={{
                            ...styles.previewBar,
                            width: previewW + 'px',
                            height: previewH + 'px',
                            bottom: '4px',
                            left: '4px'
                        }} />
                        {result.width}x{result.height}
                    </div>
                </div>
            </div>
        );
    }
}

export default SmartSizePreview;
