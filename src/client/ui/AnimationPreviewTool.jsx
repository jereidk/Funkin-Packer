/**
 * AnimationPreviewTool - Standalone experimental panel that actually plays
 * back an Animation.json's Adobe Animate-style symbol hierarchy against its
 * spritemap, instead of just listing/counting it like AnimationTreeView
 * does. Independent from Sheet Splitter on purpose - this is a from-scratch
 * playback engine (AnimationRenderer.js), not a repack tool.
 *
 * Takes the same three files as a BetterTA export: the atlas texture PNG,
 * its spritemap JSON (the { ATLAS: { SPRITES: [...] } } shape Adobe
 * Animate/BetterTA produces - not this app's own internal rect format),
 * and Animation.json itself.
 */

import React from 'react';
import { Observer, GLOBAL_EVENT } from '../Observer';
import I18 from '../utils/I18';
import AnimationRenderer from '../utils/AnimationRenderer';

class AnimationPreviewTool extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            textureLoaded: false,
            spritemapLoaded: false,
            animationLoaded: false,
            error: null,
            playing: false,
            tick: 0,
            selectedState: 'all', // 'all' or a named state from listNamedStates()
            fps: 24,
            zoom: 1
        };

        this.image = null;
        this.spriteRects = new Map(); // name -> {x, y, w, h, rotated}
        this.animData = null;
        this.rootDuration = 1;
        this.namedStates = [];
        this.rafId = null;
        this.lastFrameTime = 0;

        this.canvasRef = React.createRef();

        this.close = this.close.bind(this);
        this.selectTexture = this.selectTexture.bind(this);
        this.selectSpritemap = this.selectSpritemap.bind(this);
        this.selectAnimation = this.selectAnimation.bind(this);
        this.togglePlay = this.togglePlay.bind(this);
        this.onStateChange = this.onStateChange.bind(this);
        this.onScrub = this.onScrub.bind(this);
        this.tickLoop = this.tickLoop.bind(this);
    }

    componentWillUnmount() {
        this.stopLoop();
    }

    close() {
        Observer.emit(GLOBAL_EVENT.HIDE_ANIMATION_PREVIEW);
    }

    setError(msg) {
        this.setState({ error: msg });
    }

    selectTexture(e) {
        let file = e.target.files[0];
        if (!file) return;

        let img = new Image();
        img.onload = () => {
            this.image = img;
            this.setState({ textureLoaded: true, error: null });
            this.renderFrame();
        };
        img.onerror = () => this.setError('No se pudo cargar la textura.');
        img.src = URL.createObjectURL(file);
    }

    selectSpritemap(e) {
        let file = e.target.files[0];
        if (!file) return;

        let reader = new FileReader();
        reader.onload = ev => {
            try {
                let data = JSON.parse(ev.target.result);
                let sprites = data?.ATLAS?.SPRITES;
                if (!Array.isArray(sprites)) {
                    throw new Error('No tiene la forma esperada { ATLAS: { SPRITES: [...] } }');
                }

                this.spriteRects = new Map();
                for (let entry of sprites) {
                    let s = entry.SPRITE;
                    if (s && s.name) this.spriteRects.set(s.name, s);
                }

                this.setState({ spritemapLoaded: true, error: null });
                this.renderFrame();
            } catch (err) {
                this.setError('spritemap.json inválido: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    selectAnimation(e) {
        let file = e.target.files[0];
        if (!file) return;

        let reader = new FileReader();
        reader.onload = ev => {
            try {
                let data = JSON.parse(ev.target.result);
                if (!data.AN || !data.SD) {
                    throw new Error('No tiene la forma esperada { AN, SD, MD }');
                }

                this.animData = data;
                this.rootDuration = AnimationRenderer.getRootDuration(data);
                this.namedStates = AnimationRenderer.listNamedStates(data);

                let fps = data.MD?.FRT || 24;

                this.setState({
                    animationLoaded: true,
                    error: null,
                    fps,
                    tick: 0,
                    selectedState: 'all'
                });
                this.renderFrame();
            } catch (err) {
                this.setError('Animation.json inválido: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    getActiveRange() {
        if (this.state.selectedState === 'all') {
            return { start: 0, duration: this.rootDuration };
        }
        let found = this.namedStates.find(s => s.name === this.state.selectedState);
        return found ? { start: found.startTick, duration: found.duration } : { start: 0, duration: this.rootDuration };
    }

    togglePlay() {
        if (this.state.playing) {
            this.stopLoop();
            this.setState({ playing: false });
        } else {
            this.setState({ playing: true }, () => {
                this.lastFrameTime = performance.now();
                this.rafId = requestAnimationFrame(this.tickLoop);
            });
        }
    }

    stopLoop() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    tickLoop(now) {
        if (!this.state.playing) return;

        let elapsedSeconds = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;

        let { start, duration } = this.getActiveRange();
        let ticksElapsed = elapsedSeconds * this.state.fps;
        let localTick = ((this.state.tick - start) + ticksElapsed) % duration;
        if (localTick < 0) localTick += duration;

        this.setState({ tick: start + localTick }, () => this.renderFrame());
        this.rafId = requestAnimationFrame(this.tickLoop);
    }

    onStateChange(e) {
        let selectedState = e.target.value;
        this.setState({ selectedState }, () => {
            let { start } = this.getActiveRange();
            this.setState({ tick: start }, () => this.renderFrame());
        });
    }

    onScrub(e) {
        let { start } = this.getActiveRange();
        let localTick = Number(e.target.value);
        this.setState({ tick: start + localTick }, () => this.renderFrame());
    }

    drawSprite(ctx, rect, matrix) {
        let img = this.image;
        if (!img) return;

        ctx.save();
        ctx.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);

        if (rect.rotated) {
            // Atlas stores the packed (rotated) footprint w x h; the original
            // sprite is h x w. Same rotate-then-draw approach SpritesPlayer.jsx
            // uses for this app's own output - kept consistent, though this
            // atlas comes from a different exporter (Adobe Animate/BetterTA)
            // whose rotation convention hasn't been independently confirmed to
            // match; flag any visibly wrong rotated part as a follow-up.
            ctx.translate(rect.h / 2, rect.w / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
        } else {
            ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        }

        ctx.restore();
    }

    renderFrame() {
        let canvas = this.canvasRef.current;
        if (!canvas || !this.animData) return;

        let ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;

        // Stage origin: Animate places symbol instances relative to a
        // center-ish stage origin in every real export seen so far - center
        // the canvas so typical MX translations land on-screen instead of
        // off in the corner.
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);

        let drawList = AnimationRenderer.computeDrawList(this.animData, Math.floor(this.state.tick));
        for (let entry of drawList) {
            let rect = this.spriteRects.get(entry.spriteName);
            if (!rect) continue; // sprite referenced but not in this spritemap - skip rather than crash
            this.drawSprite(ctx, rect, entry.matrix);
        }

        ctx.restore();
    }

    render() {
        let { textureLoaded, spritemapLoaded, animationLoaded, error, playing, tick, selectedState, zoom } = this.state;

        let allLoaded = textureLoaded && spritemapLoaded && animationLoaded;
        let canvasW = this.animData?.MD?.W || 1280;
        let canvasH = this.animData?.MD?.H || 720;

        let { start, duration } = allLoaded ? this.getActiveRange() : { start: 0, duration: 1 };
        let localTick = Math.floor(tick) - start;

        return (
            <div className="sheet-splitter-shader">
                <div className="sheet-splitter-content animation-preview-content">
                    <div style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: '8px' }}>
                        🎬 {I18.f("ANIMATE_PREVIEW")} <span style={{ fontWeight: 'normal', fontSize: '11px', opacity: 0.7 }}>(experimental)</span>
                    </div>

                    <table style={{ margin: '0 auto 10px' }}>
                        <tbody>
                            <tr>
                                <td>
                                    <div className="btn back-800 border-color-gray color-white file-upload">
                                        Textura (PNG)
                                        <input type="file" accept="image/png" onChange={this.selectTexture} />
                                    </div>
                                </td>
                                <td>
                                    <div className="btn back-800 border-color-gray color-white file-upload">
                                        spritemap.json
                                        <input type="file" accept=".json" onChange={this.selectSpritemap} />
                                    </div>
                                </td>
                                <td>
                                    <div className="btn back-800 border-color-gray color-white file-upload">
                                        Animation.json
                                        <input type="file" accept=".json" onChange={this.selectAnimation} />
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    {error && <div style={{ color: '#ff6b6b', textAlign: 'center', marginBottom: '8px' }}>⚠ {error}</div>}

                    <div style={{
                        width: '100%',
                        height: '380px',
                        overflow: 'auto',
                        border: '1px solid var(--border-color)',
                        background: '#1a1a2e',
                        textAlign: 'center'
                    }}>
                        <canvas
                            ref={this.canvasRef}
                            width={canvasW}
                            height={canvasH}
                            style={{
                                imageRendering: 'pixelated',
                                transform: `scale(${zoom})`,
                                transformOrigin: 'top left',
                                marginTop: '10px'
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <button
                            className="btn back-800 border-color-gray color-white"
                            disabled={!allLoaded}
                            onClick={this.togglePlay}
                        >
                            {playing ? '⏹ Stop' : '▶ Play'}
                        </button>

                        <select disabled={!allLoaded} value={selectedState} onChange={this.onStateChange}>
                            <option value="all">Timeline completa ({this.rootDuration} frames)</option>
                            {this.namedStates.map(s => (
                                <option key={s.name} value={s.name}>{s.name} ({s.duration} frames)</option>
                            ))}
                        </select>

                        <input
                            type="range"
                            min="0"
                            max={Math.max(0, duration - 1)}
                            value={Math.max(0, Math.min(localTick, duration - 1))}
                            disabled={!allLoaded}
                            onChange={this.onScrub}
                            style={{ width: '180px' }}
                        />
                        <span style={{ fontSize: '12px', minWidth: '60px' }}>
                            {Math.max(0, localTick) + 1} / {duration}
                        </span>

                        <label style={{ fontSize: '12px' }}>
                            Zoom:
                            <input
                                type="range" min="0.25" max="2" step="0.25" value={zoom}
                                onChange={e => this.setState({ zoom: Number(e.target.value) })}
                                style={{ width: '80px', marginLeft: '6px' }}
                            />
                        </label>
                    </div>

                    <div style={{ textAlign: 'center', marginTop: '12px' }}>
                        <div className="btn back-800 border-color-gray color-white" onClick={this.close}>{I18.f("CLOSE")}</div>
                    </div>
                </div>
            </div>
        );
    }
}

export default AnimationPreviewTool;
