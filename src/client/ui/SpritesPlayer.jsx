import React from 'react';
import ReactDOM from 'react-dom';
import {GLOBAL_EVENT, Observer} from "../Observer";
import {cleanPrefix, smartSortImages} from '../utils/common';
import sparrowStore from '../store/sparrowStore';

class SpritesPlayer extends React.Component {

    constructor(props) {
        super(props);

        this.state = {
            currentFrame: 0,
            isPlaying: false,
            zoom: 1,
            fps: 12,
            backgroundColor: '#1a1a2e',
            showGrid: false,
            playbackDirection: 'forward',
            selectedGroup: 'all',  // 'all' or a specific group name
            groupedAnimations: {}   // Computed groups: { groupName: [textureIndices] }
        };

        this.textures = [];
        this.currentTextures = [];
        this.width = 0;
        this.height = 0;
        this.selectedImages = [];
        this.animationTimer = null;
        this.lastPropsData = null;

        // Bind all methods to preserve 'this' context
        this.updateCurrentTextures = this.updateCurrentTextures.bind(this);
        this.calculateGroups = this.calculateGroups.bind(this);
        this.selectGroup = this.selectGroup.bind(this);
        this.playAnimation = this.playAnimation.bind(this);
        this.stopAnimation = this.stopAnimation.bind(this);
        this.setZoom = this.setZoom.bind(this);
        this.onFpsChange = this.onFpsChange.bind(this);
        this.onBackgroundColorChange = this.onBackgroundColorChange.bind(this);
        this.toggleGrid = this.toggleGrid.bind(this);
        this.toggleDirection = this.toggleDirection.bind(this);
        this.goToFirstFrame = this.goToFirstFrame.bind(this);
        this.goToLastFrame = this.goToLastFrame.bind(this);
        this.nextFrame = this.nextFrame.bind(this);
        this.prevFrame = this.prevFrame.bind(this);
        this.renderCurrentFrame = this.renderCurrentFrame.bind(this);

        Observer.on(GLOBAL_EVENT.IMAGES_LIST_SELECTED_CHANGED, this.onImagesSelected, this);
    }

    /**
     * Calculate animation groups based on sprite prefixes
     * Groups sprites by their cleanPrefix() name
     */
    calculateGroups() {
        const groups = {};

        // Mirrors TextureView's semantics: an empty selection means "nothing
        // filtered out", not "nothing to show". Without this, opening the
        // player with no explicit tree selection (the common case right
        // after packing) produced an empty viewer with zero frames.
        const hasSelection = this.selectedImages.length > 0;

        for (let i = 0; i < this.textures.length; i++) {
            const tex = this.textures[i];
            // Check if this texture is in selectedImages
            const isSelected = !hasSelection || (!tex.config.cloned
                ? this.selectedImages.indexOf(tex.config.file) >= 0
                : this.selectedImages.indexOf(tex.config.originalFile) >= 0);

            if (!isSelected) continue;

            const prefix = cleanPrefix(tex.config.originalFile || tex.config.file || tex.config.name);
            
            if (!groups[prefix]) {
                groups[prefix] = [];
            }
            groups[prefix].push(i);
        }
        
        // Sort groups and their members
        for (const groupName in groups) {
            groups[groupName].sort((a, b) => {
                return smartSortImages(
                    this.textures[a].config.name,
                    this.textures[b].config.name
                );
            });
        }
        
        return groups;
    }

    /**
     * Select an animation group to play
     */
    selectGroup(groupName) {
        this.setState({ selectedGroup: groupName }, () => {
            this.updateCurrentTextures();
        });
    }

    onImagesSelected(list=[]) {
        this.selectedImages = list;
        // Recalculate groups when selection changes
        const groups = this.calculateGroups();
        this.setState({ groupedAnimations: groups });
        this.updateCurrentTextures();
    }

    componentDidMount() {
        if(this.props.start) this.setup();
        else this.stopAnimation();
    }

    componentDidUpdate(prevProps) {
        // Only re-run setup if data actually changed (optimization)
        const dataChanged = prevProps.data !== this.props.data;
        const startChanged = prevProps.start !== this.props.start;

        if (this.props.start) {
            if (dataChanged) {
                this.setup();
            } else if (startChanged) {
                // Just starting, but data is the same
                // Need to render the current frame, not just forceUpdate
                this.setState({ currentFrame: 0 }, () => {
                    this.renderCurrentFrame();
                });
            }
        } else {
            // Stop animation and sync isPlaying state
            if (this.animationTimer) {
                this.stopAnimation();
            }
        }
    }

    componentWillUnmount() {
        this.stopAnimation();
    }

    setup() {
        if (!this.refs.playerContainer) return;
        
        ReactDOM.findDOMNode(this.refs.playerContainer).className = "player-view-container " + this.props.textureBack;

        this.textures = [];

        if(!this.props.data) return;

        this.width = 0;
        this.height = 0;

        for(let part of this.props.data) {
            let baseTexture = part.buffer;

            for (let config of part.data) {
                var w = config.sourceSize ? config.sourceSize.w : 0;
                var h = config.sourceSize ? config.sourceSize.h : 0;

                var prefix = cleanPrefix(config.originalFile || config.file || config.name);

                // Safe access to sparrowStore with fallback
                var maxMap = null;
                try {
                    maxMap = sparrowStore && typeof sparrowStore.getMaxMapEntry === 'function' 
                        ? sparrowStore.getMaxMapEntry(prefix) 
                        : null;
                } catch (e) {
                    console.warn('[SpritesPlayer] Error getting maxMapEntry:', e);
                }
                
                if (maxMap && typeof maxMap.mw === 'number' && typeof maxMap.mh === 'number') {
                    w = maxMap.mw;
                    h = maxMap.mh;
                }

                // Fallback if dimensions are invalid
                if (!w || w <= 0) w = config.frame ? config.frame.w : 0;
                if (!h || h <= 0) h = config.frame ? config.frame.h : 0;

                if (this.width < w) this.width = w;
                if (this.height < h) this.height = h;

                this.textures.push({
                    config: config,
                    baseTexture: baseTexture,
                    name: config.name
                });
            }
        }

        if(this.width < 256) this.width = 256;
        if(this.height < 200) this.height = 200;

        let canvas = ReactDOM.findDOMNode(this.refs.view);
        if (canvas) {
            canvas.width = this.width;
            canvas.height = this.height;
        }

        this.lastPropsData = this.props.data;
        
        // Calculate initial groups
        const groups = this.calculateGroups();
        this.setState({ groupedAnimations: groups });
        
        this.updateCurrentTextures();
    }

    /**
     * Get sprite dimensions with safe fallbacks
     */
    getSpriteDimensions(texture) {
        var w = texture.config.sourceSize ? texture.config.sourceSize.w : 0;
        var h = texture.config.sourceSize ? texture.config.sourceSize.h : 0;

        var prefix = cleanPrefix(texture.config.originalFile || texture.config.file || texture.config.name);

        try {
            var maxMap = sparrowStore && typeof sparrowStore.getMaxMapEntry === 'function' 
                ? sparrowStore.getMaxMapEntry(prefix) 
                : null;
            
            if (maxMap && typeof maxMap.mw === 'number' && typeof maxMap.mh === 'number') {
                w = maxMap.mw;
                h = maxMap.mh;
            }
        } catch (e) {
            console.warn('[SpritesPlayer] Error getting sprite dimensions:', e);
        }

        // Fallback to frame dimensions if needed
        if (!w || w <= 0) w = texture.config.frame ? texture.config.frame.w : 256;
        if (!h || h <= 0) h = texture.config.frame ? texture.config.frame.h : 256;

        return { w, h };
    }

    updateCurrentTextures() {
        const { selectedGroup, groupedAnimations } = this.state;
        
        let textureIndices = [];
        
        if (selectedGroup === 'all') {
            // Get all indices from all groups
            for (const groupName in groupedAnimations) {
                textureIndices = textureIndices.concat(groupedAnimations[groupName]);
            }
        } else {
            // Get indices from specific group
            textureIndices = groupedAnimations[selectedGroup] || [];
        }
        
        // Build textures array from indices
        let textures = textureIndices.map(idx => this.textures[idx]);
        
        // Sort them
        textures = textures.sort((a, b) => {
            return smartSortImages(a.config.name, b.config.name);
        });

        this.currentTextures = textures;
        this.setState({ currentFrame: 0 });
        this.renderCurrentFrame();
    }

    /**
     * Render the current frame based on state
     * This is a pure render method - no frame advancement logic
     */
    renderCurrentFrame() {
        const canvas = ReactDOM.findDOMNode(this.refs.view);
        if (!canvas) return;
        
        let ctx = canvas.getContext("2d");

        // Clear with background color
        ctx.fillStyle = this.state.backgroundColor;
        ctx.fillRect(0, 0, this.width, this.height);

        // Draw grid if enabled
        if (this.state.showGrid) {
            this.drawGrid(ctx);
        }

        const currentFrame = this.state.currentFrame;
        let texture = this.currentTextures[currentFrame];
        if(!texture) return;

        const { w, h } = this.getSpriteDimensions(texture);

        let buffer = ReactDOM.findDOMNode(this.refs.buffer);
        if (!buffer) return;
        
        buffer.width = w;
        buffer.height = h;

        let bufferCtx = buffer.getContext("2d");
        bufferCtx.clearRect(0, 0, w, h);

        if(texture.config.rotated) {
            // When rotated, frame.w and frame.h are swapped in the atlas
            // spriteSourceSize still contains original dimensions
            bufferCtx.save();

            // Translate to center of original sprite space
            const centerX = texture.config.spriteSourceSize.x + texture.config.spriteSourceSize.w / 2;
            const centerY = texture.config.spriteSourceSize.y + texture.config.spriteSourceSize.h / 2;
            bufferCtx.translate(centerX, centerY);
            bufferCtx.rotate(-Math.PI / 2);

            // Draw the rotated sprite from atlas to buffer
            // Source: frame from atlas (width=frame.h, height=frame.w due to rotation)
            // Dest: center at origin, using original dimensions (swapped)
            bufferCtx.drawImage(
                texture.baseTexture,
                texture.config.frame.x, texture.config.frame.y,
                texture.config.frame.h, texture.config.frame.w,
                -texture.config.spriteSourceSize.h / 2, -texture.config.spriteSourceSize.w / 2,
                texture.config.spriteSourceSize.h, texture.config.spriteSourceSize.w
            );

            bufferCtx.restore();
        }
        else {
            bufferCtx.drawImage(texture.baseTexture,
                texture.config.frame.x, texture.config.frame.y,
                texture.config.frame.w, texture.config.frame.h,
                texture.config.spriteSourceSize.x, texture.config.spriteSourceSize.y,
                texture.config.spriteSourceSize.w, texture.config.spriteSourceSize.h);
        }

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(buffer, 0, 0);

        if(this.currentTextures.length > 1) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
            ctx.font = "bold 12px Arial";
            ctx.fillText(`${currentFrame + 1}/${this.currentTextures.length}`, 5, 15);
        }
    }

    drawGrid(ctx) {
        const gridSize = 16;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;

        // Vertical lines
        for (let x = 0; x <= this.width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.height);
            ctx.stroke();
        }

        // Horizontal lines
        for (let y = 0; y <= this.height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.width, y);
            ctx.stroke();
        }
    }

    stopAnimation() {
        if(this.animationTimer) {
            clearInterval(this.animationTimer);
            this.animationTimer = null;
            this.setState({ isPlaying: false });
        }
    }

    playAnimation() {
        if(this.animationTimer) return;
        if (!this.currentTextures.length) return;

        this.setState({ isPlaying: true });

        this.animationTimer = setInterval(() => {
            let nextFrame;
            if (this.state.playbackDirection === 'forward') {
                nextFrame = (this.state.currentFrame + 1) % this.currentTextures.length;
            } else {
                nextFrame = (this.state.currentFrame - 1 + this.currentTextures.length) % this.currentTextures.length;
            }

            // Use setState callback to ensure render happens after state update
            this.setState({ currentFrame: nextFrame }, () => {
                this.renderCurrentFrame();
            });
        }, 1000 / this.state.fps);
    }

    setZoom(val) {
        this.setState({ zoom: val });
        let canvas = ReactDOM.findDOMNode(this.refs.view);
        canvas.style.transform = `scale(${val})`;
        canvas.style.transformOrigin = 'top left';
    }

    onFpsChange(e) {
        const newFps = parseInt(e.target.value) || 12;
        this.setState({ fps: newFps });
        if (this.animationTimer) {
            this.stopAnimation();
            this.playAnimation();
        }
    }

    onBackgroundColorChange(e) {
        const color = e.target.value;
        this.setState({ backgroundColor: color });
        this.renderCurrentFrame();
    }

    toggleGrid() {
        this.setState(prev => ({ showGrid: !prev.showGrid }));
        this.renderCurrentFrame();
    }

    toggleDirection() {
        this.setState(prev => ({ 
            playbackDirection: prev.playbackDirection === 'forward' ? 'reverse' : 'forward' 
        }));
    }

    goToFirstFrame() {
        this.setState({ currentFrame: 0 });
        this.renderCurrentFrame();
    }

    goToLastFrame() {
        if (!this.currentTextures.length) return;
        const lastFrame = this.currentTextures.length - 1;
        this.setState({ currentFrame: lastFrame });
        this.renderCurrentFrame();
    }

    nextFrame() {
        if (!this.currentTextures.length) return;
        const next = (this.state.currentFrame + 1) % this.currentTextures.length;
        this.setState({ currentFrame: next });
        this.renderCurrentFrame();
    }

    prevFrame() {
        if (!this.currentTextures.length) return;
        const prev = (this.state.currentFrame - 1 + this.currentTextures.length) % this.currentTextures.length;
        this.setState({ currentFrame: prev });
        this.renderCurrentFrame();
    }

    render() {
        const { currentFrame, isPlaying, zoom, fps, backgroundColor, showGrid, playbackDirection, selectedGroup, groupedAnimations } = this.state;
        
        // Get sorted group names for display
        const groupNames = Object.keys(groupedAnimations).sort();
        
        return (
            <div className="player-view-container" ref="playerContainer">
                <div style={{ 
                    display: 'flex', 
                    height: '100%',
                    background: 'var(--bg-primary)',
                    borderRadius: '8px',
                    overflow: 'hidden'
                }}>
                    <div style={{ 
                        flex: 1, 
                        display: 'flex', 
                        flexDirection: 'column',
                        padding: '10px'
                    }}>
                        {/* Animation Group Selector */}
                        {groupNames.length > 0 && (
                            <div style={{
                                marginBottom: '10px',
                                padding: '8px',
                                background: 'var(--bg-secondary)',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)'
                            }}>
                                <div style={{
                                    color: 'var(--text-secondary)',
                                    fontSize: '11px',
                                    marginBottom: '6px'
                                }}>
                                    🎬 Animación:
                                </div>
                                <div style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '6px'
                                }}>
                                    <button
                                        onClick={() => this.selectGroup('all')}
                                        style={{
                                            padding: '6px 12px',
                                            borderRadius: '16px',
                                            border: 'none',
                                            background: selectedGroup === 'all' ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                                            color: selectedGroup === 'all' ? '#fff' : 'var(--text-primary)',
                                            cursor: 'pointer',
                                            fontSize: '11px',
                                            fontWeight: selectedGroup === 'all' ? 'bold' : 'normal'
                                        }}
                                    >
                                        Todos ({this.currentTextures.length})
                                    </button>
                                    {groupNames.map(name => (
                                        <button
                                            key={name}
                                            onClick={() => this.selectGroup(name)}
                                            style={{
                                                padding: '6px 12px',
                                                borderRadius: '16px',
                                                border: 'none',
                                                background: selectedGroup === name ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                                                color: selectedGroup === name ? '#fff' : 'var(--text-primary)',
                                                cursor: 'pointer',
                                                fontSize: '11px',
                                                fontWeight: selectedGroup === name ? 'bold' : 'normal'
                                            }}
                                            title={`${groupedAnimations[name].length} frames`}
                                        >
                                            {name} ({groupedAnimations[name].length})
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        
                        <div style={{ 
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'auto',
                            background: 'var(--bg-secondary)',
                            borderRadius: '6px',
                            minHeight: '200px',
                            padding: '10px'
                        }}>
                            <div style={{
                                position: 'relative',
                                borderRadius: '4px',
                                overflow: 'hidden',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                            }}>
                                <canvas ref='view' style={{
                                    imageRendering: 'pixelated',
                                    display: 'block'
                                }}/>
                                <canvas ref='buffer' style={{ display: 'none' }}/>
                            </div>
                        </div>

                        <div style={{ 
                            padding: '12px',
                            display: 'flex',
                            gap: '10px',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            background: 'var(--bg-secondary)',
                            borderRadius: '6px',
                            marginTop: '8px'
                        }}>
                            {/* Playback Controls */}
                            <button
                                onClick={this.goToFirstFrame}
                                title="Go to first frame"
                                style={{
                                    padding: '6px 10px',
                                    borderRadius: '4px',
                                    border: 'none',
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    fontSize: '14px'
                                }}
                            >
                                ⏮
                            </button>
                            
                            <button
                                onClick={this.prevFrame}
                                title="Previous frame"
                                style={{
                                    padding: '6px 10px',
                                    borderRadius: '4px',
                                    border: 'none',
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    fontSize: '14px'
                                }}
                            >
                                ◀
                            </button>

                            <button
                                onClick={() => {
                                    // playAnimation()/stopAnimation() already set isPlaying
                                    // themselves. Toggling it again here stacked a second
                                    // update onto the same batched React update, landing on
                                    // the opposite of whatever they had just set - so the
                                    // button's label/color flipped to the wrong state on
                                    // every click regardless of whether the timer was
                                    // actually running.
                                    if (this.animationTimer) {
                                        this.stopAnimation();
                                    } else {
                                        this.playAnimation();
                                    }
                                }}
                                style={{
                                    padding: '8px 20px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: isPlaying ? '#ef4444' : '#22c55e',
                                    color: 'white',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '13px'
                                }}
                            >
                                {isPlaying ? '⏹ Stop' : '▶ Play'}
                            </button>

                            <button
                                onClick={this.nextFrame}
                                title="Next frame"
                                style={{
                                    padding: '6px 10px',
                                    borderRadius: '4px',
                                    border: 'none',
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    fontSize: '14px'
                                }}
                            >
                                ▶
                            </button>

                            <button
                                onClick={this.goToLastFrame}
                                title="Go to last frame"
                                style={{
                                    padding: '6px 10px',
                                    borderRadius: '4px',
                                    border: 'none',
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    fontSize: '14px'
                                }}
                            >
                                ⏭
                            </button>

                            <button
                                onClick={this.toggleDirection}
                                title="Toggle playback direction"
                                style={{
                                    padding: '6px 10px',
                                    borderRadius: '4px',
                                    border: 'none',
                                    background: playbackDirection === 'reverse' ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    fontSize: '12px'
                                }}
                            >
                                {playbackDirection === 'forward' ? '→' : '←'}
                            </button>

                            {/* Divider */}
                            <div style={{width: '1px', height: '24px', background: 'var(--border-color)'}} />

                            {/* FPS Control */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <label style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>FPS:</label>
                                <input
                                    type="number"
                                    value={fps}
                                    onChange={this.onFpsChange}
                                    min="1"
                                    max="120"
                                    style={{
                                        width: '55px',
                                        padding: '4px',
                                        borderRadius: '4px',
                                        border: '1px solid var(--border-color)',
                                        background: 'var(--bg-tertiary)',
                                        color: 'var(--text-primary)',
                                        fontSize: '12px'
                                    }}
                                />
                            </div>

                            {/* Frame Counter */}
                            <div style={{ 
                                color: 'var(--text-primary)', 
                                fontSize: '12px',
                                fontWeight: 'bold',
                                background: 'var(--bg-tertiary)',
                                padding: '4px 10px',
                                borderRadius: '4px'
                            }}>
                                {currentFrame + 1} / {this.currentTextures.length}
                            </div>

                            {/* Divider */}
                            <div style={{width: '1px', height: '24px', background: 'var(--border-color)'}} />

                            {/* Background Color Picker */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <label style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>BG:</label>
                                <input
                                    type="color"
                                    value={backgroundColor}
                                    onChange={(e) => this.onBackgroundColorChange(e)}
                                    title="Background color"
                                    style={{
                                        width: '32px',
                                        height: '32px',
                                        padding: '0',
                                        border: '2px solid var(--border-color)',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        background: 'transparent'
                                    }}
                                />
                            </div>

                            {/* Grid Toggle */}
                            <button
                                onClick={this.toggleGrid}
                                title="Toggle grid"
                                style={{
                                    padding: '6px 10px',
                                    borderRadius: '4px',
                                    border: 'none',
                                    background: showGrid ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    fontSize: '11px'
                                }}
                            >
                                # Grid
                            </button>

                            {/* Spacer */}
                            <div style={{ flex: 1 }} />

                            {/* Zoom Control */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <label style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>Zoom:</label>
                                <input
                                    type="range"
                                    min="0.25"
                                    max="4"
                                    step="0.25"
                                    value={zoom}
                                    onChange={(e) => this.setZoom(parseFloat(e.target.value))}
                                    style={{ width: '80px' }}
                                />
                                <span style={{ color: 'var(--accent-color)', fontSize: '11px', minWidth: '35px' }}>{zoom}x</span>
                            </div>
                        </div>
                    </div>

                    <div style={{ 
                        width: '220px',
                        background: 'var(--bg-secondary)',
                        borderLeft: '1px solid var(--border-color)',
                        padding: '10px',
                        overflowY: 'auto'
                    }}>
                        <div style={{ 
                            color: 'var(--text-secondary)', 
                            fontSize: '11px',
                            marginBottom: '8px',
                            borderBottom: '1px solid var(--border-color)',
                            paddingBottom: '6px'
                        }}>
                            📁 {this.currentTextures.length} sprites selected
                        </div>

                        <div style={{ fontSize: '11px' }}>
                            {this.currentTextures.slice(0, 50).map((tex, i) => (
                                <div 
                                    key={i}
                                    style={{
                                        padding: '4px 6px',
                                        background: currentFrame === i ? 'rgba(74, 158, 255, 0.2)' : 'transparent',
                                        borderRadius: '4px',
                                        marginBottom: '2px',
                                        cursor: 'pointer',
                                        borderLeft: currentFrame === i ? '2px solid var(--accent-color)' : '2px solid transparent',
                                        color: currentFrame === i ? 'var(--text-primary)' : 'var(--text-secondary)',
                                        transition: 'all 0.15s ease'
                                    }}
                                    onClick={() => {
                                        this.setState({ currentFrame: i });
                                        this.renderCurrentFrame();
                                    }}
                                >
                                    {tex.name}
                                </div>
                            ))}
                            {this.currentTextures.length > 50 && (
                                <div style={{ color: 'var(--text-secondary)', fontSize: '10px', marginTop: '8px', opacity: 0.6 }}>
                                    ... and {this.currentTextures.length - 50} more
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

export default SpritesPlayer;
